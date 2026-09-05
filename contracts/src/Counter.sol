// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice A public counter for testing deployment and app integration.
contract Counter {
    uint256 public number;

    event Incremented(address indexed caller, uint256 number);

    function increment() external {
        number += 1;
        emit Incremented(msg.sender, number);
    }
}
