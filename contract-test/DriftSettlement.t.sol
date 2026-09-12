// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {DriftOrder} from "../contracts/DriftOrder.sol";
import {DriftCheckout} from "../contracts/DriftCheckout.sol";
import {DriftItems} from "../contracts/DriftItems.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface Vm {
    struct Log { bytes32[] topics; bytes data; address emitter; }
    function chainId(uint256) external;
    function prank(address) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function deal(address, uint256) external;
    function warp(uint256) external;
    function etch(address, bytes calldata) external;
    function expectRevert() external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

/// Local proof fixture only. Production contracts always call the actual fixed precompile.
contract LocalBlockProver is INativeQueryVerifier {
    mapping(bytes32 => uint64) public approved;
    function approve(bytes calldata data, uint64 height) external { approved[keccak256(data)] = height; }
    function verify(uint64 key, uint64 height, bytes calldata data, MerkleProof calldata proof, ContinuityProof calldata) external view returns (bool) {
        return key == 1 && height != 0 && proof.root == keccak256(data) && approved[keccak256(data)] == height;
    }
}

contract DriftSettlementTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SELLER_KEY = 1001;
    address private seller;
    address private buyer;
    DriftCheckout private checkout;
    DriftItems private market;
    LocalBlockProver private prover;

    function setUp() public {
        seller = vm.addr(SELLER_KEY); buyer = vm.addr(1002);
        vm.chainId(11155111); checkout = new DriftCheckout();
        vm.chainId(102031); market = new DriftItems(address(this), address(checkout), 11155111, 1);
        LocalBlockProver implementation = new LocalBlockProver();
        vm.etch(address(0x0FD2), address(implementation).code); prover = LocalBlockProver(address(0x0FD2));
        vm.deal(buyer, 2 ether);
    }
    function terms(bytes32 item) private view returns (DriftOrder.Terms memory) {
        return DriftOrder.Terms(item, seller, buyer, 0.01 ether, uint64(block.timestamp + 300), 11155111, address(checkout), 102031, address(market), item);
    }
    function signature(DriftOrder.Terms memory t) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SELLER_KEY, MessageHashUtils.toEthSignedMessageHash(DriftOrder.id(t)));
        return abi.encodePacked(r, s, v);
    }
    function reserve(DriftOrder.Terms memory t, bytes memory sig) private {
        market.mint(t.itemId, seller, seller, 1, hex"a63f32f4e8cf");
        vm.prank(seller); market.reserve(t, sig);
    }
    function encodeReceipt(Vm.Log memory log, uint8 status) private pure returns (bytes memory) {
        EvmV1Decoder.LogEntry[] memory logs = new EvmV1Decoder.LogEntry[](1);
        logs[0] = EvmV1Decoder.LogEntry(log.emitter, log.topics, log.data);
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(uint64(0), uint64(100000), address(1), false, log.emitter, uint256(0), bytes(""));
        chunks[1] = bytes("");
        chunks[2] = abi.encode(status, uint64(50000), logs, bytes(""));
        return abi.encode(uint8(2), chunks);
    }
    function settle(bytes32 id, bytes memory data) private {
        INativeQueryVerifier.MerkleProof memory proof = INativeQueryVerifier.MerkleProof(keccak256(data), new INativeQueryVerifier.MerkleProofEntry[](0));
        INativeQueryVerifier.ContinuityProof memory continuity = INativeQueryVerifier.ContinuityProof(bytes32(0), new bytes32[](0));
        market.settle(id, 100, data, proof, continuity);
    }
    function owner(bytes32 id) private view returns (address result) { (result,,,,,) = market.items(id); }

    function testPaidDelayedProofAndEquip() public {
        DriftOrder.Terms memory t = terms(keccak256("crafted cargo rig")); bytes memory sig = signature(t);
        reserve(t, sig); require(owner(t.itemId) == address(market));
        vm.chainId(11155111); vm.recordLogs();
        vm.prank(buyer); checkout.pay{value: t.amount}(t, sig);
        Vm.Log memory log = vm.getRecordedLogs()[0];
        require(seller.balance == t.amount, "seller receives source ETH");
        vm.warp(t.expires + 86400);
        vm.expectRevert(); checkout.closeUnpaid(t);
        vm.chainId(102031); require(owner(t.itemId) == address(market), "paid reservation survives expiry");
        bytes memory data = encodeReceipt(log, 1); prover.approve(data, 100); settle(DriftOrder.id(t), data);
        require(owner(t.itemId) == buyer, "proof releases the actual crafted item");
        vm.expectRevert(); settle(DriftOrder.id(t), data);
        bytes32 ship = keccak256("buyer's boat"); market.setInstallation(t.itemId, buyer, ship);
        require(market.installed(ship, 1) == t.itemId);
        vm.expectRevert(); market.setInstallation(t.itemId, buyer, keccak256("second boat"));
        market.setInstallation(t.itemId, buyer, bytes32(0)); require(market.installed(ship, 1) == bytes32(0));
        bytes32 livery = keccak256("earned livery"); market.mint(livery, buyer, seller, 3, hex"24776ef4e8cf");
        market.setInstallation(livery, buyer, ship);
        vm.expectRevert(); market.setInstallation(livery, buyer, ship);
    }

    function testUnpaidCancellationRejectsInvalidEvidence() public {
        DriftOrder.Terms memory t = terms(keccak256("second crafted rig")); bytes memory sig = signature(t); reserve(t, sig);
        vm.chainId(11155111); vm.expectRevert(); checkout.closeUnpaid(t);
        vm.warp(t.expires + 1); vm.recordLogs(); checkout.closeUnpaid(t);
        Vm.Log memory log = vm.getRecordedLogs()[0];
        vm.prank(buyer); vm.expectRevert(); checkout.pay{value: t.amount}(t, sig);
        vm.chainId(102031);
        bytes memory good = encodeReceipt(log, 1);
        vm.expectRevert(); settle(DriftOrder.id(t), good); // unverified bytes
        bytes memory failed = encodeReceipt(log, 0); prover.approve(failed, 100);
        vm.expectRevert(); settle(DriftOrder.id(t), failed);
        log.emitter = address(0xBAD); bytes memory spoof = encodeReceipt(log, 1); prover.approve(spoof, 100);
        vm.expectRevert(); settle(DriftOrder.id(t), spoof);
        prover.approve(good, 100); settle(DriftOrder.id(t), good);
        require(owner(t.itemId) == seller, "only positive unpaid closure returns the item");
        vm.expectRevert(); market.mint(t.itemId, buyer, seller, 1, hex"000000ffffff");
    }
}
