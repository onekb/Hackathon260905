// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Counter} from "../src/Counter.sol";

contract CounterTest {
    function testInitialValue() public {
        Counter counter = new Counter();
        require(counter.number() == 0, "must start at zero");
    }

    function testRepeatedIncrements() public {
        Counter counter = new Counter();
        counter.increment();
        counter.increment();
        require(counter.number() == 2, "must persist increments");
    }
}
