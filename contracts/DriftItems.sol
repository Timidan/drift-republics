// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {DriftOrder} from "./DriftOrder.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/INativeQueryVerifier.sol";

/// @notice Creditcoin game inventory and proof-settled player escrow.
/// @dev The game authority is trusted for crafting and dock/capacity checks, but cannot seize or cancel escrow.
contract DriftItems {
    struct Item {
        address owner;
        address maker;
        uint8 kind; // 1 cargo rig, 2 engine, 3 single-use livery
        bytes6 finish; // RGB hull followed by RGB sail
        bytes32 installedShip;
        bool consumed;
    }
    enum OrderStatus { Unknown, Reserved, Owned, Cancelled }
    struct Order { DriftOrder.Terms terms; OrderStatus status; }

    address public immutable authority;
    address public immutable sourceCheckout;
    uint64 public immutable sourceChainId;
    uint64 public immutable sourceChainKey;
    INativeQueryVerifier public constant VERIFIER = INativeQueryVerifier(0x0000000000000000000000000000000000000FD2);
    mapping(bytes32 => Item) public items;
    mapping(bytes32 => Order) private orders;
    mapping(bytes32 => bytes32) public itemOrder;
    mapping(bytes32 => mapping(uint8 => bytes32)) public installed;
    event ItemMinted(bytes32 indexed itemId, address indexed owner, address maker, uint8 kind, bytes6 finish);
    event InstallationChanged(bytes32 indexed itemId, address indexed owner, bytes32 ship, bool consumed);
    event ItemReserved(bytes32 indexed orderId, bytes32 indexed itemId, address indexed buyer);
    event OrderSettled(bytes32 indexed orderId, bytes32 indexed itemId, address indexed owner, bool paid);

    constructor(address gameAuthority, address checkout, uint64 chainId, uint64 chainKey) {
        require(gameAuthority != address(0) && checkout != address(0) && chainId != block.chainid && chainKey != 0, "Invalid configuration");
        authority = gameAuthority; sourceCheckout = checkout; sourceChainId = chainId; sourceChainKey = chainKey;
    }
    modifier onlyAuthority() { require(msg.sender == authority, "Game authority only"); _; }

    function order(bytes32 id) external view returns (DriftOrder.Terms memory terms, OrderStatus status) {
        return (orders[id].terms, orders[id].status);
    }
    function orderId(DriftOrder.Terms calldata terms) external pure returns (bytes32) { return DriftOrder.id(terms); }

    /// @notice One mint per completed game item. The authority verifies recipe inputs and ownership offchain.
    function mint(bytes32 id, address owner, address maker, uint8 kind, bytes6 finish) external onlyAuthority {
        require(id != bytes32(0) && items[id].owner == address(0), "Item already minted");
        require(owner != address(0) && owner != address(this) && maker != address(0) && kind >= 1 && kind <= 3, "Invalid item");
        items[id] = Item(owner, maker, kind, finish, bytes32(0), false);
        emit ItemMinted(id, owner, maker, kind, finish);
    }

    /// @notice Authenticated game commands request this operation; the server locks the boat until it is confirmed.
    function setInstallation(bytes32 id, address expectedOwner, bytes32 ship) external onlyAuthority {
        Item storage item = items[id];
        require(item.owner == expectedOwner && expectedOwner != address(0) && expectedOwner != address(this) && !item.consumed, "Item unavailable");
        if (ship == bytes32(0)) {
            require(item.installedShip != bytes32(0) && item.kind != 3, "Nothing to remove");
            delete installed[item.installedShip][item.kind];
            item.installedShip = bytes32(0);
        } else {
            require(item.installedShip == bytes32(0), "Already installed");
            if (item.kind == 3) item.consumed = true;
            else {
                require(installed[ship][item.kind] == bytes32(0), "Remove existing fitting first");
                installed[ship][item.kind] = id;
            }
            item.installedShip = ship;
        }
        emit InstallationChanged(id, expectedOwner, ship, item.consumed);
    }

    function reserve(DriftOrder.Terms calldata terms, bytes calldata signature) external {
        require(terms.destination == address(this) && terms.destinationChainId == block.chainid, "Wrong destination");
        require(terms.source == sourceCheckout && terms.sourceChainId == sourceChainId, "Wrong source");
        require(msg.sender == terms.seller && terms.buyer != address(0) && terms.buyer != terms.seller && terms.amount > 0, "Invalid parties or price");
        require(block.timestamp < terms.expires && DriftOrder.authorized(terms, signature), "Invalid authorization");
        bytes32 id = DriftOrder.id(terms);
        Item storage item = items[terms.itemId];
        require(orders[id].status == OrderStatus.Unknown, "Order already exists");
        require(item.owner == msg.sender && !item.consumed && item.installedShip == bytes32(0), "Item unavailable");
        item.owner = address(this); itemOrder[terms.itemId] = id;
        orders[id] = Order(terms, OrderStatus.Reserved);
        emit ItemReserved(id, terms.itemId, terms.buyer);
    }

    /// @notice Anyone may relay the authentic terminal source event, even long after the payment window.
    /// @dev There is deliberately no destination-only expiry or administrative escrow release.
    function settle(
        bytes32 id, uint64 height, bytes calldata encodedTransaction,
        INativeQueryVerifier.MerkleProof calldata merkleProof,
        INativeQueryVerifier.ContinuityProof calldata continuityProof
    ) external {
        Order storage pending = orders[id];
        require(pending.status == OrderStatus.Reserved, "Order is not reserved");
        require(VERIFIER.verify(sourceChainKey, height, encodedTransaction, merkleProof, continuityProof), "Invalid source proof");
        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "Source transaction failed");
        bool found; bool paid;
        for (uint256 i; i < receipt.receiptLogs.length; ++i) {
            EvmV1Decoder.LogEntry memory entry = receipt.receiptLogs[i];
            if (entry.address_ != sourceCheckout || entry.topics.length != 2 || entry.topics[1] != id || entry.data.length != 0) continue;
            if (entry.topics[0] == keccak256("OrderPaid(bytes32)")) { found = true; paid = true; break; }
            if (entry.topics[0] == keccak256("OrderClosedUnpaid(bytes32)")) { found = true; break; }
        }
        require(found, "No bound terminal event");
        Item storage item = items[pending.terms.itemId];
        require(item.owner == address(this) && itemOrder[pending.terms.itemId] == id, "Escrow mismatch");
        item.owner = paid ? pending.terms.buyer : pending.terms.seller;
        pending.status = paid ? OrderStatus.Owned : OrderStatus.Cancelled;
        delete itemOrder[pending.terms.itemId];
        emit OrderSettled(id, pending.terms.itemId, item.owner, paid);
    }
}
