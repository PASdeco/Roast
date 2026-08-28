"""Direct-mode tests for RoastJury (mocked web + LLM, captured validators).

Run: pytest tests/direct/test_roast_jury.py -v
"""
import json

import pytest


PROFILE_HTML = (
    "<html><head>"
    '<meta property="og:title" content="Ada Lovelace (@ada_lovelace) on X"/>'
    '<meta property="og:description" content="Building analytical engines. '
    'Writing about computation, poetry and punchcards."/>'
    '<meta property="og:image" content="https://pbs.twimg.com/profile_images/ada/200x200.jpg"/>'
    "</head><body>profile</body></html>"
)

MISSING_HTML = (
    "<html><head>"
    '<meta name="description" content="The user profile you&#x27;re looking for could not be found."/>'
    "</head></html>"
)


def judge_json(verdict="SOLID"):
    return json.dumps(
        {
            "verdict": verdict,
            "summary": "A punchy one-line summary.",
            "reasoning": "Detailed reasoning grounded in the bio text.",
        }
    )


def moderator_json(overall_verdict="SOLID"):
    return json.dumps(
        {
            "overall_verdict": overall_verdict,
            "thesis": "Strong ideas trapped inside a profile that hides them.",
            "roast": "Three niches fighting for custody of one bio.",
            "improvements": [
                {
                    "area": "Bio",
                    "issue": "Lists five identities without one concrete claim.",
                    "recommendation": "Lead with what you build and for whom.",
                },
                {
                    "area": "Positioning",
                    "issue": "Profile reads generic.",
                    "recommendation": "Pick the engine niche and say it out loud.",
                },
                {
                    "area": "Content",
                    "issue": "The visible positioning does not promise a clear topic.",
                    "recommendation": "Name the computation theme readers can expect.",
                },
            ],
            "disagreement": "",
        }
    )


def install_happy_mocks(direct_vm):
    direct_vm.mock_web(r"https://x\.com/.*", {"status": 200, "body": PROFILE_HTML})
    # Order matters (first match wins): the moderator prompt embeds judge
    # labels in its JSON payload, so anchor on "head moderator" FIRST,
    # then the roast judge persona, then the generic judge fallback.
    direct_vm.mock_llm(r".*head moderator.*", moderator_json())
    direct_vm.mock_llm(r".*Roast Judge.*", judge_json("NEEDS_WORK"))
    direct_vm.mock_llm(r".*", judge_json("SOLID"))


# ----------------------------------------------------------------------
# Happy path
# ----------------------------------------------------------------------


def test_submit_roast_stores_full_result(direct_vm, direct_deploy, direct_alice):
    install_happy_mocks(direct_vm)
    contract = direct_deploy("contracts/roast_jury.py")
    direct_vm.sender = direct_alice

    result = contract.submit_roast("ada_lovelace")

    assert result["username"] == "ada_lovelace"
    assert result["display_name"] == "Ada Lovelace (@ada_lovelace)"
    assert "analytical engines" in result["bio"]
    assert len(result["judges"]) == 5
    roles = {j["role"] for j in result["judges"]}
    assert roles == {
        "recruiter",
        "growth_critic",
        "content_critic",
        "profile_critic",
        "roast_judge",
    }
    assert len(result["improvements"]) == 3
    assert result["thesis"] != ""
    assert result["roast"] != ""
    assert contract.get_roast_count() == 1
    assert contract.get_last_username() == "ada_lovelace"


def test_roast_judge_gets_its_own_verdict(direct_vm, direct_deploy, direct_alice):
    install_happy_mocks(direct_vm)
    contract = direct_deploy("contracts/roast_jury.py")

    contract.submit_roast("ada_lovelace")
    stored = contract.get_roast("ada_lovelace")

    by_role = {j["role"]: j for j in stored["judges"]}
    assert by_role["roast_judge"]["verdict"] == "NEEDS_WORK"
    assert by_role["recruiter"]["verdict"] == "SOLID"


def test_input_normalization(direct_vm, direct_deploy, direct_alice):
    install_happy_mocks(direct_vm)
    contract = direct_deploy("contracts/roast_jury.py")

    result = contract.submit_roast("@Ada_Lovelace")

    assert result["username"] == "ada_lovelace"


# ----------------------------------------------------------------------
# Input validation + failure paths
# ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    [
        "https://x.com/ada",
        "ada/lovelace",
        "ada.lovelace",
        "",
        "this_username_is_way_too_long_for_x",
        "has space",
        "dollar$ign",
    ],
)
def test_invalid_usernames_rejected(direct_vm, direct_deploy, bad):
    contract = direct_deploy("contracts/roast_jury.py")

    with pytest.raises(Exception):
        contract.submit_roast(bad)


def test_missing_profile_rejected_and_not_stored(direct_vm, direct_deploy):
    direct_vm.mock_web(r"https://x\.com/.*", {"status": 200, "body": MISSING_HTML})
    direct_vm.mock_llm(r".*", judge_json())
    contract = direct_deploy("contracts/roast_jury.py")

    with pytest.raises(Exception, match="could not be found"):
        contract.submit_roast("ghost404")

    assert contract.has_roast("ghost404") is False
    assert contract.get_roast_count() == 0


def test_duplicate_roast_rejected(direct_vm, direct_deploy, direct_alice):
    install_happy_mocks(direct_vm)
    contract = direct_deploy("contracts/roast_jury.py")

    contract.submit_roast("ada_lovelace")

    with pytest.raises(Exception, match="already roasted"):
        contract.submit_roast("ada_lovelace")


def test_moderator_failure_blocks_storage(direct_vm, direct_deploy, direct_alice):
    direct_vm.mock_web(r"https://x\.com/.*", {"status": 200, "body": PROFILE_HTML})
    direct_vm.mock_llm(r".*head moderator.*", "this is not json at all")
    direct_vm.mock_llm(r".*", judge_json())
    contract = direct_deploy("contracts/roast_jury.py")

    with pytest.raises(Exception, match="usable evaluation"):
        contract.submit_roast("ada_lovelace")

    assert contract.has_roast("ada_lovelace") is False


def test_partial_judge_failure_degrades_to_unclear(direct_vm, direct_deploy, direct_alice):
    direct_vm.mock_web(r"https://x\.com/.*", {"status": 200, "body": PROFILE_HTML})
    # Anchor the moderator FIRST (its payload embeds all judge labels),
    # then fail only the recruiter; everyone else succeeds.
    direct_vm.mock_llm(r".*head moderator.*", moderator_json())
    direct_vm.mock_llm(r".*Recruiter.*", "garbage not json")
    direct_vm.mock_llm(r".*", judge_json())
    contract = direct_deploy("contracts/roast_jury.py")

    result = contract.submit_roast("ada_lovelace")

    by_role = {j["role"]: j for j in result["judges"]}
    assert by_role["recruiter"]["verdict"] == "UNCLEAR"
    assert by_role["growth_critic"]["verdict"] == "SOLID"


def test_unreachable_x_reports_profile_not_found(direct_vm, direct_deploy):
    direct_vm.mock_web(
        r"https://x\.com/.*",
        {"status": 503, "body": "upstream error"},
    )
    direct_vm.mock_llm(r".*", judge_json())
    contract = direct_deploy("contracts/roast_jury.py")

    with pytest.raises(Exception, match="could not be found"):
        contract.submit_roast("ada_lovelace")


# ----------------------------------------------------------------------
# Consensus behavior (validators re-run the pipeline independently)
# ----------------------------------------------------------------------


def test_validator_agrees_on_identical_data(direct_vm, direct_deploy):
    install_happy_mocks(direct_vm)
    contract = direct_deploy("contracts/roast_jury.py")

    contract.submit_roast("ada_lovelace")  # captures the leader run

    assert direct_vm.run_validator() is True


def test_validator_accepts_single_judge_dissent(direct_vm, direct_deploy):
    """Weighted rule: exact=2, adjacent=1; need >=5 of 10.
    Four exact + one adjacent = 9 -> pass."""
    install_happy_mocks(direct_vm)
    contract = direct_deploy("contracts/roast_jury.py")

    contract.submit_roast("ada_lovelace")

    # Validator's re-run flips ONLY the roast judge's band to an
    # ADJACENT value (NEEDS_WORK -> SOLID is not adjacent; SOLID sits
    # two notches from NEEDS_WORK on STRONG/SOLID/NEEDS_WORK/WEAK/UNCLEAR,
    # so use WEAK instead: NEEDS_WORK and WEAK are adjacent).
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"https://x\.com/.*", {"status": 200, "body": PROFILE_HTML})
    direct_vm.mock_llm(r".*head moderator.*", moderator_json())
    direct_vm.mock_llm(r".*Roast Judge.*", judge_json("WEAK"))
    direct_vm.mock_llm(r".*", judge_json("SOLID"))

    assert direct_vm.run_validator() is True


def test_validator_rejects_diverging_verdicts(direct_vm, direct_deploy):
    """Multiple distant flips push the score below 3.5/5 -> reject."""
    install_happy_mocks(direct_vm)
    contract = direct_deploy("contracts/roast_jury.py")

    contract.submit_roast("ada_lovelace")

    # Validator flips EVERY judge to WEAK: leader was SOLID(4x)+NEEDS_WORK.
    # Distances: SOLID->WEAK = 2 (0 pts) x4, NEEDS_WORK->WEAK = 1 (1 pt).
    # Score = 1/10 < 5/10 -> genuine disagreement, rejected.
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"https://x\.com/.*", {"status": 200, "body": PROFILE_HTML})
    direct_vm.mock_llm(r".*head moderator.*", moderator_json())
    direct_vm.mock_llm(r".*", judge_json("WEAK"))

    assert direct_vm.run_validator() is False


def test_validator_accepts_adjacent_bands_on_all_judges(direct_vm, direct_deploy):
    """Every judge exactly ONE band apart from the leader scores
    5 x 1pt = 5/10 which now PASSES at the tolerant threshold — this is
    precisely the borderline-profile case that produced UNDETERMINED on
    studionet and must succeed under the weighted rule."""
    install_happy_mocks(direct_vm)
    contract = direct_deploy("contracts/roast_jury.py")

    contract.submit_roast("ada_lovelace")

    direct_vm.clear_mocks()
    direct_vm.mock_web(r"https://x\.com/.*", {"status": 200, "body": PROFILE_HTML})
    direct_vm.mock_llm(r".*head moderator.*", moderator_json())
    # Leader bands: SOLID x4 + NEEDS_WORK(roast). Shift every judge one
    # notch down the scale: SOLID->NEEDS_WORK, NEEDS_WORK->WEAK.
    direct_vm.mock_llm(r".*Roast Judge.*", judge_json("WEAK"))
    direct_vm.mock_llm(r".*", judge_json("NEEDS_WORK"))

    # 5 adjacent = 5/10 >= 5/10 -> accepted (borderline agreement).
    assert direct_vm.run_validator() is True


def test_validator_rejects_profile_presence_flip(direct_vm, direct_deploy):
    install_happy_mocks(direct_vm)
    contract = direct_deploy("contracts/roast_jury.py")

    contract.submit_roast("ada_lovelace")

    direct_vm.clear_mocks()
    direct_vm.mock_web(r"https://x\.com/.*", {"status": 200, "body": MISSING_HTML})

    assert direct_vm.run_validator() is False


def test_validator_rejects_canonical_url_divergence(direct_vm, direct_deploy):
    install_happy_mocks(direct_vm)
    contract = direct_deploy("contracts/roast_jury.py")

    contract.submit_roast("ada_lovelace")
    leader = direct_vm._captured_validators[-1][0]
    tampered = dict(leader)
    tampered["canonical_url"] = "https://x.com/someone_else"

    assert direct_vm.run_validator(leader_result=tampered) is False


def test_validator_rejects_profile_source_url_divergence(direct_vm, direct_deploy):
    install_happy_mocks(direct_vm)
    contract = direct_deploy("contracts/roast_jury.py")

    contract.submit_roast("ada_lovelace")
    leader = direct_vm._captured_validators[-1][0]
    tampered = dict(leader)
    tampered["profile"] = dict(leader["profile"])
    tampered["profile"]["source_url"] = "https://x.com/someone_else"

    assert direct_vm.run_validator(leader_result=tampered) is False


def test_validator_rejects_evidence_divergence(direct_vm, direct_deploy):
    install_happy_mocks(direct_vm)
    contract = direct_deploy("contracts/roast_jury.py")

    contract.submit_roast("ada_lovelace")

    changed_html = PROFILE_HTML.replace(
        "Building analytical engines.", "Selling unrelated courses."
    )
    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r"https://x\.com/ada_lovelace", {"status": 200, "body": changed_html}
    )
    direct_vm.mock_llm(r".*head moderator.*", moderator_json())
    direct_vm.mock_llm(r".*", judge_json("SOLID"))

    assert direct_vm.run_validator() is False


def test_validator_rejects_non_substantive_moderation(direct_vm, direct_deploy):
    install_happy_mocks(direct_vm)
    contract = direct_deploy("contracts/roast_jury.py")

    contract.submit_roast("ada_lovelace")
    leader = direct_vm._captured_validators[-1][0]
    tampered = dict(leader)
    tampered["moderation"] = dict(leader["moderation"])
    tampered["moderation"]["improvements"] = []

    assert direct_vm.run_validator(leader_result=tampered) is False

COSMETIC_VARIANT_HTML = (
    "<html><head>"
    '<meta property="og:title" content="ADA LOVELACE  (@ada_lovelace) on X"/>'
    '<meta property="og:description" content="Building ANALYTICAL engines.'
    '   Writing about computation, poetry and punchcards."/>'
    '<meta property="og:image" content="https://pbs.twimg.com/profile_images/ada/400x400.jpg"/>'
    "</head><body>profile</body></html>"
)


def test_validator_tolerates_cosmetic_fetch_variance(direct_vm, direct_deploy):
    """Leader and validator fetches differ ONLY by casing / whitespace /
    avatar CDN variant: normalized evidence must match and consensus must
    pass. Real content changes still diverge (see rejection tests above)."""
    install_happy_mocks(direct_vm)
    contract = direct_deploy("contracts/roast_jury.py")

    contract.submit_roast("ada_lovelace")

    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r"https://x\.com/ada_lovelace", {"status": 200, "body": COSMETIC_VARIANT_HTML}
    )
    direct_vm.mock_llm(r".*head moderator.*", moderator_json())
    direct_vm.mock_llm(r".*Roast Judge.*", judge_json("NEEDS_WORK"))
    direct_vm.mock_llm(r".*", judge_json("SOLID"))

    assert direct_vm.run_validator() is True


def test_validator_accepts_case_insensitive_improvement_area(direct_vm, direct_deploy):
    """Improvement areas may vary in case / punctuation; the substantive
    check must still accept them instead of rejecting usable moderation."""
    install_happy_mocks(direct_vm)
    contract = direct_deploy("contracts/roast_jury.py")
    contract.submit_roast("ada_lovelace")

    leader = direct_vm._captured_validators[-1][0]
    tampered = dict(leader)
    tampered["moderation"] = dict(leader["moderation"])
    improvements = [dict(item) for item in leader["moderation"]["improvements"]]
    improvements[0]["area"] = " bio "
    improvements[1]["area"] = "Positioning:"
    improvements[2]["area"] = "CONTENT"
    tampered["moderation"]["improvements"] = improvements

    assert direct_vm.run_validator(leader_result=tampered) is True


def test_validator_rejects_unknown_improvement_area(direct_vm, direct_deploy):
    install_happy_mocks(direct_vm)
    contract = direct_deploy("contracts/roast_jury.py")
    contract.submit_roast("ada_lovelace")

    leader = direct_vm._captured_validators[-1][0]
    tampered = dict(leader)
    tampered["moderation"] = dict(leader["moderation"])
    improvements = [dict(item) for item in leader["moderation"]["improvements"]]
    improvements[1]["area"] = "Everything Else"
    tampered["moderation"]["improvements"] = improvements

    assert direct_vm.run_validator(leader_result=tampered) is False

