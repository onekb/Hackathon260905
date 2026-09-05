// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";

/// @notice Freely issued hackathon test tokens. Not USDC, not redeemable, and have no monetary value.
contract DemoUSD is ERC20, ERC20Capped {
    uint256 public constant FAUCET_AMOUNT = 1_000 * 1e6;
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 1e6;
    bool public constant IS_DEMO_ASSET = true;

    mapping(address account => bool) public hasClaimed;

    error AlreadyClaimed();

    event FaucetClaimed(address indexed account, uint256 amount);

    constructor() ERC20("Demo USD - Test Asset Only", "dUSD") ERC20Capped(MAX_SUPPLY) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function _update(address from, address to, uint256 amount) internal override(ERC20, ERC20Capped) {
        super._update(from, to, amount);
    }

    /// @dev One lifetime claim per address. This is a demo convenience, not Sybil resistance.
    function faucet() external {
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();
        hasClaimed[msg.sender] = true;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }
}
