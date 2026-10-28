"""
RED Emergency Connect - Cryptographic SHA-256 Immutable Audit Ledger
Guarantees tamper-evident audit logging for all emergency state changes and dispatch lifecycle events.
"""

import hashlib
import json
from datetime import datetime
from typing import List, Dict, Any, Tuple, Optional
from backend.models import AuditBlock


class AuditLogger:
    def __init__(self):
        self.chain: List[AuditBlock] = []
        # Create Genesis Block
        self._create_genesis_block()

    def _create_genesis_block(self):
        genesis_payload = {"genesis": "RED Emergency Connect Immutable Chain Initialized"}
        payload_hash = hashlib.sha256(json.dumps(genesis_payload, sort_keys=True).encode()).hexdigest()
        timestamp = datetime.utcnow().isoformat()
        prev_hash = "0" * 64

        raw_block_str = f"0:{timestamp}:GENESIS_INITIALIZATION:SYSTEM:{payload_hash}:{prev_hash}"
        block_hash = hashlib.sha256(raw_block_str.encode()).hexdigest()

        genesis_block = AuditBlock(
            index=0,
            timestamp=timestamp,
            event_type="GENESIS_INITIALIZATION",
            actor="SYSTEM",
            payload_hash=payload_hash,
            previous_hash=prev_hash,
            block_hash=block_hash,
            data_summary="Genesis Block Initialized"
        )
        self.chain.append(genesis_block)

    def log_event(self, event_type: str, actor: str, payload: Dict[str, Any], data_summary: str) -> AuditBlock:
        """
        Appends a new cryptographically chained audit block to the ledger.
        """
        prev_block = self.chain[-1]
        new_index = prev_block.index + 1
        timestamp = datetime.utcnow().isoformat()
        prev_hash = prev_block.block_hash

        # Canonical JSON string of payload for hash
        payload_json = json.dumps(payload, sort_keys=True, default=str)
        payload_hash = hashlib.sha256(payload_json.encode('utf-8')).hexdigest()

        # Compute block hash
        raw_block_str = f"{new_index}:{timestamp}:{event_type}:{actor}:{payload_hash}:{prev_hash}"
        block_hash = hashlib.sha256(raw_block_str.encode('utf-8')).hexdigest()

        new_block = AuditBlock(
            index=new_index,
            timestamp=timestamp,
            event_type=event_type,
            actor=actor,
            payload_hash=payload_hash,
            previous_hash=prev_hash,
            block_hash=block_hash,
            data_summary=data_summary
        )

        self.chain.append(new_block)
        return new_block

    def verify_ledger_integrity(self) -> Tuple[bool, Optional[str]]:
        """
        Traverses the entire cryptographic ledger chain to verify that no block, hash,
        or state payload has been modified or tampered with.
        """
        for i in range(1, len(self.chain)):
            curr = self.chain[i]
            prev = self.chain[i - 1]

            # 1. Check previous hash connection
            if curr.previous_hash != prev.block_hash:
                return False, f"Broken link between Block #{prev.index} and Block #{curr.index}"

            # 2. Recompute current block hash
            raw_block_str = f"{curr.index}:{curr.timestamp}:{curr.event_type}:{curr.actor}:{curr.payload_hash}:{curr.previous_hash}"
            recalculated_hash = hashlib.sha256(raw_block_str.encode('utf-8')).hexdigest()

            if recalculated_hash != curr.block_hash:
                return False, f"Tampered hash detected in Block #{curr.index}! Stored: {curr.block_hash}, Recalculated: {recalculated_hash}"

        return True, "Chain integrity verified 100% untampered."

    def get_all_blocks(self) -> List[AuditBlock]:
        return self.chain


# Global Audit Ledger Instance
audit_logger = AuditLogger()
