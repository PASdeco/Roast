# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

from dataclasses import dataclass
from datetime import datetime, timezone

import typing


# RoastPayments: on-chain credit-purchase registry for Roast My X.
#
# A buyer generates a unique purchase_id off-chain, then sends GEN to this
# contract via buy_credits(purchase_id). The contract records WHO paid, HOW
# MUCH, and WHEN, so the application backend can verify every purchase
# directly on-chain instead of trusting the frontend. The owner (treasury)
# can withdraw collected GEN. Credit balances themselves live OFF-CHAIN in
# the backend ledger; this contract is the verifiable payment layer.


@allow_storage
@dataclass
class PurchaseRecord:
    purchase_id: str
    buyer: str
    amount_wei: u256
    created_at: u64


class RoastPayments(gl.Contract):
    owner: Address
    total_raised: u256
    total_withdrawn: u256
    purchase_count: u64
    purchases: TreeMap[str, PurchaseRecord]

    def __init__(self):
        self.owner = gl.message.sender_address
        self.total_raised = u256(0)
        self.total_withdrawn = u256(0)
        self.purchase_count = u64(0)

    @gl.public.view
    def get_owner(self) -> str:
        return str(self.owner)

    @gl.public.view
    def get_contract_balance(self) -> int:
        return int(self.balance)

    @gl.public.view
    def get_total_raised(self) -> int:
        return int(self.total_raised)

    @gl.public.view
    def get_total_withdrawn(self) -> int:
        return int(self.total_withdrawn)

    @gl.public.view
    def get_purchase_count(self) -> int:
        return int(self.purchase_count)

    @gl.public.write.payable
    def buy_credits(self, purchase_id: str) -> typing.Any:
        safe_id = str(purchase_id).strip()
        if len(safe_id) < 8 or len(safe_id) > 64:
            raise gl.vm.UserError(
                "[EXPECTED] purchase_id must be between 8 and 64 characters."
            )
        if safe_id in self.purchases:
            raise gl.vm.UserError(
                "[EXPECTED] purchase_id already used. Generate a fresh purchase."
            )

        paid = gl.message.value
        if paid <= u256(0):
            raise gl.vm.UserError(
                "[EXPECTED] Attach GEN to the transaction to buy credits."
            )
        if paid < u256(10**15):
            raise gl.vm.UserError(
                "[EXPECTED] Payment below the minimum purchase amount (0.001 GEN)."
            )

        buyer = str(gl.message.sender_address).strip().lower()
        record = PurchaseRecord(
            purchase_id=safe_id,
            buyer=buyer,
            amount_wei=paid,
            created_at=u64(self._now()),
        )
        self.purchases[safe_id] = record
        self.purchase_count = u64(int(self.purchase_count) + 1)
        self.total_raised = self.total_raised + paid

        return {
            "purchase_id": safe_id,
            "buyer": buyer,
            "amount_wei": int(paid),
            "created_at": int(record.created_at),
        }

    @gl.public.view
    def get_purchase(self, purchase_id: str) -> typing.Any:
        safe_id = str(purchase_id).strip()
        if safe_id not in self.purchases:
            return {
                "found": False,
                "purchase_id": safe_id,
                "buyer": "",
                "amount_wei": 0,
                "created_at": 0,
            }
        record = self.purchases[safe_id]
        return {
            "found": True,
            "purchase_id": record.purchase_id,
            "buyer": record.buyer,
            "amount_wei": int(record.amount_wei),
            "created_at": int(record.created_at),
        }

    @gl.public.view
    def has_purchase(self, purchase_id: str) -> bool:
        return str(purchase_id).strip() in self.purchases

    @gl.public.write
    def withdraw(self, amount_wei: int) -> None:
        self._only_owner()
        amount = u256(int(amount_wei))
        if amount <= u256(0):
            raise gl.vm.UserError("[EXPECTED] Withdrawal amount must be positive.")
        if amount > self.balance:
            raise gl.vm.UserError(
                "[EXPECTED] Withdrawal amount exceeds the contract balance."
            )
        self._pay_owner(amount)
        self.total_withdrawn = self.total_withdrawn + amount

    @gl.public.write
    def withdraw_all(self) -> None:
        self._only_owner()
        amount = self.balance
        if amount <= u256(0):
            raise gl.vm.UserError("[EXPECTED] Contract balance is empty.")
        self._pay_owner(amount)
        self.total_withdrawn = self.total_withdrawn + amount

    def _only_owner(self) -> None:
        caller = str(gl.message.sender_address).strip()
        if caller != str(self.owner).strip():
            raise gl.vm.UserError("[EXPECTED] Only the contract owner can do this.")

    def _pay_owner(self, amount: u256) -> None:
        _Recipient(self.owner).emit_transfer(value=amount)

    def _now(self) -> int:
        return int(datetime.now(timezone.utc).timestamp())


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass
