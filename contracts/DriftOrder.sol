// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

library DriftOrder {
    struct Terms {
        bytes32 itemId;
        address seller;
        address buyer;
        uint256 amount;
        uint64 expires;
        uint64 sourceChainId;
        address source;
        uint64 destinationChainId;
        address destination;
        bytes32 nonce;
    }

    function id(Terms memory terms) internal pure returns (bytes32) {
        return keccak256(abi.encode(keccak256("DRIFT_REPUBLICS_ORDER_V1"), terms));
    }

    function authorized(Terms memory terms, bytes memory signature) internal pure returns (bool) {
        return terms.seller != address(0) &&
            ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(id(terms)), signature) == terms.seller;
    }
}
