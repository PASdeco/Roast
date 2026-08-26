"""Direct-mode tests for RoastPayments (no network, no consensus).

Run: pytest tests/direct/test_roast_payments.py -v
"""
import pytest

ONE_GEN = 10**18


def addr_hex(raw) -> str:
    """Normalize a gltest address fixture (bytes or hex str) to 0x-hex."""
    if isinstance(raw, bytes):
        return "0x" + raw.hex()
    text = str(raw)
    if not text.startswith("0x"):
        text = "0x" + text
    return text.lower()


# ----------------------------------------------------------------------
# Purchase happy path
# ----------------------------------------------------------------------


def test_buy_credits_records_purchase(
    direct_vm, payments_contract, direct_alice
):
    direct_vm.value = 2 * ONE_GEN

    result = payments_contract.buy_credits("purchase-abc12345")

    assert result["purchase_id"] == "purchase-abc12345"
    assert result["buyer"] == addr_hex(direct_alice)
    assert result["amount_wei"] == 2 * ONE_GEN
    assert payments_contract.has_purchase("purchase-abc12345") is True
    assert payments_contract.get_purchase_count() == 1
    assert payments_contract.get_total_raised() == 2 * ONE_GEN


def test_purchase_view_round_trip(direct_vm, payments_contract):
    direct_vm.value = ONE_GEN

    payments_contract.buy_credits("purchase-roundtrip1")
    stored = payments_contract.get_purchase("purchase-roundtrip1")

    assert stored["found"] is True
    assert stored["amount_wei"] == ONE_GEN
    assert stored["created_at"] > 0


def test_unknown_purchase_reports_not_found(payments_contract):
    stored = payments_contract.get_purchase("purchase-nevermade00")

    assert stored["found"] is False
    assert payments_contract.has_purchase("purchase-nevermade00") is False


# ----------------------------------------------------------------------
# Payment validation (double-crediting / replay protection)
# ----------------------------------------------------------------------


def test_duplicate_purchase_id_is_rejected(direct_vm, payments_contract):
    direct_vm.value = ONE_GEN

    payments_contract.buy_credits("purchase-duplicate1")

    with pytest.raises(Exception, match="already used"):
        payments_contract.buy_credits("purchase-duplicate1")


def test_zero_value_is_rejected(direct_vm, payments_contract):
    direct_vm.value = 0

    with pytest.raises(Exception, match="Attach GEN"):
        payments_contract.buy_credits("purchase-zero-value")


def test_below_minimum_is_rejected(direct_vm, payments_contract):
    direct_vm.value = 999999999999999  # just under 0.001 GEN

    with pytest.raises(Exception, match="below the minimum"):
        payments_contract.buy_credits("purchase-toosmall1")


def test_short_purchase_id_is_rejected(direct_vm, payments_contract):
    direct_vm.value = ONE_GEN

    with pytest.raises(Exception, match="between 8 and 64"):
        payments_contract.buy_credits("short7")


def test_same_id_from_other_wallet_still_rejected(
    direct_vm, payments_contract, direct_bob
):
    direct_vm.value = ONE_GEN
    payments_contract.buy_credits("purchase-crosswallet")

    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="already used"):
        payments_contract.buy_credits("purchase-crosswallet")


# ----------------------------------------------------------------------
# Owner views + withdrawal
# ----------------------------------------------------------------------


def test_owner_is_set_to_deployer(payments_contract, direct_alice):
    assert payments_contract.get_owner().lower() == addr_hex(direct_alice)


def test_withdraw_records_transfer_and_updates_ledger(
    direct_vm, payments_contract, credit_contract
):
    # NOTE: gltest direct mode does not simulate native-balance movement
    # (neither payable crediting nor emit_transfer debiting), so here we
    # verify owner authorization, ledger accounting, and that the value
    # transfer call itself executes cleanly. Actual balance movement is
    # covered by studionet integration tests.
    direct_vm.value = 3 * ONE_GEN
    payments_contract.buy_credits("purchase-withdraw1")
    credit_contract(3 * ONE_GEN)

    payments_contract.withdraw(ONE_GEN)

    assert payments_contract.get_total_withdrawn() == ONE_GEN


def test_withdraw_all_drains_ledger(
    direct_vm, payments_contract, credit_contract
):
    direct_vm.value = 3 * ONE_GEN
    payments_contract.buy_credits("purchase-drainall")
    credit_contract(3 * ONE_GEN)

    payments_contract.withdraw_all()

    assert payments_contract.get_total_withdrawn() == 3 * ONE_GEN


def test_withdraw_all_on_empty_balance_rejected(payments_contract):
    with pytest.raises(Exception, match="balance is empty"):
        payments_contract.withdraw_all()


def test_non_owner_cannot_withdraw(payments_contract, direct_vm, direct_bob):
    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="Only the contract owner"):
        payments_contract.withdraw(1)
