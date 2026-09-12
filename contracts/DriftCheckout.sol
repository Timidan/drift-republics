// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {DriftOrder} from "./DriftOrder.sol";

/// @notice Source-chain native-ETH checkout. Buyers must first verify the bound destination escrow.
/// @dev No bridge or refund authority. Each signed order ends paid OR closed unpaid, never both.
contract DriftCheckout {
    enum Status { Open, Paid, ClosedUnpaid }
    mapping(bytes32 => Status) public status;
    event OrderPaid(bytes32 indexed orderId);
    event OrderClosedUnpaid(bytes32 indexed orderId);

    function orderId(DriftOrder.Terms calldata terms) external pure returns (bytes32) { return DriftOrder.id(terms); }

    function pay(DriftOrder.Terms calldata terms, bytes calldata signature) external payable {
        bytes32 id = _validate(terms);
        require(DriftOrder.authorized(terms, signature), "Seller did not authorize terms");
        require(msg.sender == terms.buyer, "Bound buyer only");
        require(block.timestamp <= terms.expires, "Payment window closed");
        require(msg.value == terms.amount, "Exact quoted ETH required");
        status[id] = Status.Paid;
        (bool sent,) = payable(terms.seller).call{value: msg.value}("");
        require(sent, "Seller could not receive ETH");
        emit OrderPaid(id);
    }

    /// @notice Permissionless positive evidence of nonpayment. It cannot close an already paid order.
    function closeUnpaid(DriftOrder.Terms calldata terms) external {
        bytes32 id = _validate(terms);
        require(block.timestamp > terms.expires, "Payment window still open");
        status[id] = Status.ClosedUnpaid;
        emit OrderClosedUnpaid(id);
    }

    function _validate(DriftOrder.Terms calldata terms) private view returns (bytes32 id) {
        require(terms.source == address(this) && terms.sourceChainId == block.chainid, "Wrong source domain");
        require(terms.destination != address(0) && terms.destinationChainId != block.chainid, "Wrong destination domain");
        require(terms.buyer != address(0) && terms.buyer != terms.seller && terms.amount > 0, "Invalid terms");
        id = DriftOrder.id(terms);
        require(status[id] == Status.Open, "Order already terminal");
    }
}
