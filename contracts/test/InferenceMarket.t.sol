// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {DemoUSD} from "../src/DemoUSD.sol";
import {InferenceMarket} from "../src/InferenceMarket.sol";

contract WrongDecimalsToken is ERC20 {
    constructor() ERC20("Wrong", "WRONG") {}
}

contract InferenceMarketTest is Test {
    DemoUSD internal usd;
    InferenceMarket internal market;
    address internal buyer = address(0xB001);
    address internal provider = address(0xA001);
    address internal router = address(0xC001);
    address internal stranger = address(0xD001);
    bytes32 internal constant MODEL = keccak256("demo-model");
    bytes32 internal constant REQUEST = keccak256("opaque-request-1");
    uint256 internal constant UNIT = 1e6;

    function setUp() public {
        vm.warp(1_000_000);
        usd = new DemoUSD();
        market = new InferenceMarket(address(usd), router);
        vm.startPrank(buyer);
        usd.faucet();
        usd.approve(address(market), type(uint256).max);
        market.deposit(100 * UNIT);
        market.authorizeRouter(10 * UNIT, uint64(block.timestamp + 1 days));
        vm.stopPrank();
        _quote(_prices(), UNIT / 10, true);
    }

    function _prices() internal pure returns (InferenceMarket.Prices memory) {
        return InferenceMarket.Prices(2 * UNIT, UNIT / 2, 3 * UNIT, 8 * UNIT);
    }

    function _usage() internal pure returns (InferenceMarket.Usage memory) {
        return InferenceMarket.Usage(1_000, 400, 200, 250);
    }

    function _quote(InferenceMarket.Prices memory prices, uint256 minimum, bool active) internal {
        vm.prank(provider);
        market.upsertQuote(MODEL, prices, minimum, active);
    }

    function _reserve(bytes32 id, uint256 amount) internal {
        uint64 version = market.getQuote(provider, MODEL).version;
        vm.prank(router);
        market.reserve(id, buyer, provider, MODEL, amount, uint64(block.timestamp + 300), version);
    }

    function _settle(bytes32 id, InferenceMarket.Usage memory usage, InferenceMarket.Outcome outcome) internal {
        vm.prank(router);
        market.settle(id, usage, outcome);
    }

    function _assertAccounting() internal view {
        assertEq(market.balances(buyer) + market.balances(provider) + market.totalLocked(), market.totalEscrowed());
        assertEq(usd.balanceOf(address(market)), market.totalEscrowed());
    }

    function testDemoTokenIsClearlyLabeledAndCapped() public view {
        assertEq(usd.decimals(), 6);
        assertEq(usd.name(), "Demo USD - Test Asset Only");
        assertEq(usd.symbol(), "dUSD");
        assertTrue(usd.IS_DEMO_ASSET());
        assertEq(usd.cap(), usd.MAX_SUPPLY());
        assertEq(usd.totalSupply(), 1_000 * UNIT);
    }

    function testFaucetCannotRepeatEvenAfterTransferringTokens() public {
        vm.startPrank(buyer);
        usd.transfer(stranger, usd.balanceOf(buyer));
        vm.expectRevert(DemoUSD.AlreadyClaimed.selector);
        usd.faucet();
        vm.stopPrank();
    }

    function testDepositWithdrawOnlyOwnedAvailableBalance() public {
        _reserve(REQUEST, UNIT);
        vm.prank(router);
        vm.expectRevert(InferenceMarket.InsufficientBalance.selector);
        market.withdraw(UNIT);
        vm.startPrank(buyer);
        vm.expectRevert(InferenceMarket.InsufficientBalance.selector);
        market.withdraw(100 * UNIT);
        market.withdraw(99 * UNIT);
        vm.stopPrank();
        assertEq(market.balances(buyer), 0);
        assertEq(market.totalLocked(), UNIT);
        assertEq(usd.balanceOf(buyer), 999 * UNIT);
        _assertAccounting();
    }

    function testDepositRequiresApprovalAndNonzeroAmount() public {
        vm.startPrank(stranger);
        usd.faucet();
        vm.expectRevert();
        market.deposit(UNIT);
        vm.expectRevert(InferenceMarket.InvalidAmount.selector);
        market.deposit(0);
        vm.expectRevert(InferenceMarket.InvalidAmount.selector);
        market.withdraw(0);
        vm.stopPrank();
    }

    function testQuotesAreWalletOwnedVersionedAndEnumerable() public {
        _quote(_prices(), 2 * UNIT, false);
        assertEq(market.quoteCount(), 1);
        (address owner, bytes32 modelId, InferenceMarket.Quote memory quote) = market.quoteAt(0);
        assertEq(owner, provider);
        assertEq(modelId, MODEL);
        assertEq(quote.version, 2);
        assertEq(quote.minReserve, 2 * UNIT);
        assertFalse(quote.active);
        vm.prank(stranger);
        market.upsertQuote(MODEL, _prices(), 0, true);
        assertEq(market.quoteCount(), 2);
        assertEq(market.getQuote(provider, MODEL).version, 2);
    }

    function testDisabledMissingAndInvalidModelQuotesAreRejected() public {
        vm.expectRevert(InferenceMarket.InvalidModelId.selector);
        market.upsertQuote(bytes32(0), _prices(), 0, true);
        vm.prank(router);
        vm.expectRevert(InferenceMarket.QuoteUnavailable.selector);
        market.reserve(REQUEST, buyer, stranger, MODEL, UNIT, uint64(block.timestamp + 300), 1);
        _quote(_prices(), UNIT, false);
        vm.prank(router);
        vm.expectRevert(InferenceMarket.QuoteUnavailable.selector);
        market.reserve(REQUEST, buyer, provider, MODEL, UNIT, uint64(block.timestamp + 300), 2);
    }

    function testQuoteChangeBeforeReserveRejectsOldVersion() public {
        _quote(InferenceMarket.Prices(100 * UNIT, 0, 0, 100 * UNIT), UNIT / 10, true);
        vm.prank(router);
        vm.expectRevert(InferenceMarket.QuoteVersionMismatch.selector);
        market.reserve(REQUEST, buyer, provider, MODEL, UNIT, uint64(block.timestamp + 300), 1);
        assertEq(market.totalLocked(), 0);
    }

    function testSuccessfulSettlementUsesAllFourCategoriesAndReleasesRemainder() public {
        _reserve(REQUEST, UNIT);
        _settle(REQUEST, _usage(), InferenceMarket.Outcome.Success);
        // 2,000 + 200 + 600 + 2,000 micro dUSD.
        uint256 charge = 4_800;
        assertEq(market.balances(provider), charge);
        assertEq(market.balances(buyer), 100 * UNIT - charge);
        InferenceMarket.Order memory order = market.getOrder(REQUEST);
        assertEq(uint256(order.state), uint256(InferenceMarket.OrderState.Settled));
        assertEq(order.charged, charge);
        assertEq(order.usage.cacheRead, 400);
        assertEq(market.getGrant(buyer, 1).spent, charge);
        assertEq(market.getGrant(buyer, 1).locked, 0);
        _assertAccounting();
    }

    function testSellerPartialFailureChargesZeroEvenForHugeReportedUsage() public {
        _reserve(REQUEST, UNIT);
        InferenceMarket.Usage memory huge = InferenceMarket.Usage(type(uint256).max, 0, 0, type(uint256).max);
        _settle(REQUEST, huge, InferenceMarket.Outcome.SellerFailed);
        assertEq(market.balances(buyer), 100 * UNIT);
        assertEq(market.balances(provider), 0);
        assertEq(market.getOrder(REQUEST).charged, 0);
        assertEq(market.getGrant(buyer, 1).spent, 0);
        assertEq(market.getOrder(REQUEST).usage.output, type(uint256).max);
        _assertAccounting();
    }

    function testPlatformFailureChargesZero() public {
        _reserve(REQUEST, UNIT);
        _settle(REQUEST, _usage(), InferenceMarket.Outcome.PlatformFailed);
        assertEq(market.balances(buyer), 100 * UNIT);
        assertEq(market.balances(provider), 0);
        _assertAccounting();
    }

    function testBuyerCancellationChargesActualTwentyCentsFromOneDollarReserve() public {
        _reserve(REQUEST, UNIT);
        _settle(REQUEST, InferenceMarket.Usage(0, 0, 0, 25_000), InferenceMarket.Outcome.BuyerCancelled);
        assertEq(market.balances(provider), 200_000);
        assertEq(market.balances(buyer), 99_800_000);
        assertEq(market.getOrder(REQUEST).charged, 200_000);
        _assertAccounting();
    }

    function testBudgetCapIsChargeableAndCanExactlyConsumeBudget() public {
        _reserve(REQUEST, UNIT);
        _settle(REQUEST, InferenceMarket.Usage(0, 0, 0, 125_000), InferenceMarket.Outcome.BudgetCapped);
        assertEq(market.balances(provider), UNIT);
        assertEq(market.balances(buyer), 99 * UNIT);
        assertEq(market.getOrder(REQUEST).charged, UNIT);
        _assertAccounting();
    }

    function testOverBudgetSettlementRevertsAndCanBeRetriedWithinBudget() public {
        _reserve(REQUEST, UNIT);
        vm.prank(router);
        vm.expectRevert(InferenceMarket.BudgetExceeded.selector);
        market.settle(REQUEST, InferenceMarket.Usage(0, 0, 0, 125_001), InferenceMarket.Outcome.Success);
        assertEq(uint256(market.getOrder(REQUEST).state), uint256(InferenceMarket.OrderState.Reserved));
        assertEq(market.totalLocked(), UNIT);
        _settle(REQUEST, _usage(), InferenceMarket.Outcome.BudgetCapped);
        _assertAccounting();
    }

    function testMinimumReserveIsNotMinimumCharge() public {
        vm.prank(router);
        vm.expectRevert(InferenceMarket.BelowMinimumReserve.selector);
        market.reserve(REQUEST, buyer, provider, MODEL, 99_999, uint64(block.timestamp + 300), 1);
        _reserve(REQUEST, 100_000);
        _settle(REQUEST, InferenceMarket.Usage(1, 0, 0, 0), InferenceMarket.Outcome.Success);
        assertEq(market.balances(provider), 2);
        assertEq(market.balances(buyer), 100 * UNIT - 2);
    }

    function testPricesRemainSnapshotAfterSellerChangesOrDisablesQuote() public {
        _reserve(REQUEST, UNIT);
        _quote(InferenceMarket.Prices(500 * UNIT, 500 * UNIT, 500 * UNIT, 500 * UNIT), 50 * UNIT, false);
        _settle(REQUEST, _usage(), InferenceMarket.Outcome.Success);
        InferenceMarket.Order memory order = market.getOrder(REQUEST);
        assertEq(order.quoteVersion, 1);
        assertEq(order.prices.output, 8 * UNIT);
        assertEq(order.charged, 4_800);
        assertEq(market.getQuote(provider, MODEL).version, 2);
    }

    function testRoundOnceAcrossCategoriesAndRetainSubunitFees() public view {
        InferenceMarket.Prices memory prices = InferenceMarket.Prices(1, 1, 1, 1);
        assertEq(market.calculateCharge(prices, InferenceMarket.Usage(0, 0, 0, 0)), 0);
        assertEq(market.calculateCharge(prices, InferenceMarket.Usage(1, 1, 1, 1)), 1);
        assertEq(market.calculateCharge(prices, InferenceMarket.Usage(250_000, 250_000, 250_000, 250_000)), 1);
        assertEq(market.calculateCharge(prices, InferenceMarket.Usage(250_001, 250_000, 250_000, 250_000)), 2);
    }

    function testCalculateChargeSupportsProductsLargerThanUint256() public view {
        assertEq(
            market.calculateCharge(
                InferenceMarket.Prices(type(uint256).max, 0, 0, 0), InferenceMarket.Usage(UNIT, 0, 0, 0)
            ),
            type(uint256).max
        );
    }

    function testConcurrentRequestsCannotExceedGrantAndUnusedReserveBecomesAvailable() public {
        _reserve(REQUEST, 6 * UNIT);
        vm.prank(router);
        vm.expectRevert(InferenceMarket.GrantLimitExceeded.selector);
        market.reserve(bytes32(uint256(2)), buyer, provider, MODEL, 5 * UNIT, uint64(block.timestamp + 300), 1);
        _reserve(bytes32(uint256(2)), 4 * UNIT);
        _settle(REQUEST, _usage(), InferenceMarket.Outcome.Success);
        _reserve(bytes32(uint256(3)), 6 * UNIT - 4_800);
        InferenceMarket.Grant memory grant = market.getGrant(buyer, 1);
        assertEq(grant.spent + grant.locked, 10 * UNIT);
        _assertAccounting();
    }

    function testConcurrentRequestsCannotExceedBuyerBalance() public {
        vm.prank(buyer);
        market.authorizeRouter(200 * UNIT, uint64(block.timestamp + 1 days));
        _reserve(REQUEST, 60 * UNIT);
        vm.prank(router);
        vm.expectRevert(InferenceMarket.InsufficientBalance.selector);
        market.reserve(bytes32(uint256(2)), buyer, provider, MODEL, 41 * UNIT, uint64(block.timestamp + 300), 1);
        _assertAccounting();
    }

    function testRevocationBlocksNewRequestsButExistingOrderCanSettle() public {
        _reserve(REQUEST, UNIT);
        vm.prank(buyer);
        market.revokeRouter();
        vm.prank(router);
        vm.expectRevert(InferenceMarket.GrantUnavailable.selector);
        market.reserve(bytes32(uint256(2)), buyer, provider, MODEL, UNIT, uint64(block.timestamp + 300), 1);
        _settle(REQUEST, _usage(), InferenceMarket.Outcome.Success);
        assertTrue(market.getGrant(buyer, 1).revoked);
        assertEq(market.getGrant(buyer, 1).spent, 4_800);
        _assertAccounting();
    }

    function testReplacingGrantNeverResetsInflightOldGrantOrMutatesNewGrant() public {
        _reserve(REQUEST, 8 * UNIT);
        vm.prank(buyer);
        assertEq(market.authorizeRouter(2 * UNIT, uint64(block.timestamp + 1 days)), 2);
        _reserve(bytes32(uint256(2)), 2 * UNIT);
        _settle(REQUEST, _usage(), InferenceMarket.Outcome.Success);
        InferenceMarket.Grant memory oldGrant = market.getGrant(buyer, 1);
        InferenceMarket.Grant memory newGrant = market.getGrant(buyer, 2);
        assertTrue(oldGrant.revoked);
        assertEq(oldGrant.locked, 0);
        assertEq(oldGrant.spent, 4_800);
        assertEq(newGrant.locked, 2 * UNIT);
        assertEq(newGrant.spent, 0);
        vm.prank(router);
        vm.expectRevert(InferenceMarket.GrantLimitExceeded.selector);
        market.reserve(bytes32(uint256(3)), buyer, provider, MODEL, UNIT, uint64(block.timestamp + 300), 1);
        _assertAccounting();
    }

    function testExpiredGrantBlocksNewOrderButEarlierReservationCanFinish() public {
        vm.prank(buyer);
        market.authorizeRouter(UNIT, uint64(block.timestamp + 10));
        _reserve(REQUEST, UNIT);
        vm.warp(block.timestamp + 10);
        vm.prank(router);
        vm.expectRevert(InferenceMarket.GrantUnavailable.selector);
        market.reserve(bytes32(uint256(2)), buyer, provider, MODEL, UNIT, uint64(block.timestamp + 300), 1);
        _settle(REQUEST, _usage(), InferenceMarket.Outcome.Success);
        _assertAccounting();
    }

    function testExpiredOrderReclaimsWithoutRouterAndCanBeWithdrawn() public {
        _reserve(REQUEST, UNIT);
        uint64 deadline = market.getOrder(REQUEST).deadline;
        vm.prank(buyer);
        vm.expectRevert(InferenceMarket.OrderNotExpired.selector);
        market.reclaimExpired(REQUEST);
        vm.warp(deadline);
        vm.prank(stranger);
        vm.expectRevert(InferenceMarket.Unauthorized.selector);
        market.reclaimExpired(REQUEST);
        vm.startPrank(buyer);
        market.reclaimExpired(REQUEST);
        market.withdraw(100 * UNIT);
        vm.stopPrank();
        assertEq(usd.balanceOf(buyer), 1_000 * UNIT);
        assertEq(market.totalEscrowed(), 0);
        assertEq(uint256(market.getOrder(REQUEST).state), uint256(InferenceMarket.OrderState.Reclaimed));
        _assertAccounting();
    }

    function testDeadlineBoundaryDisallowsSettlementAndAllowsReclaim() public {
        _reserve(REQUEST, UNIT);
        vm.warp(market.getOrder(REQUEST).deadline);
        vm.prank(router);
        vm.expectRevert(InferenceMarket.SettlementExpired.selector);
        market.settle(REQUEST, _usage(), InferenceMarket.Outcome.Success);
        vm.prank(buyer);
        market.reclaimExpired(REQUEST);
        _assertAccounting();
    }

    function testSettledOrderCannotBeSettledReclaimedOrReservedAgain() public {
        _reserve(REQUEST, UNIT);
        _settle(REQUEST, _usage(), InferenceMarket.Outcome.BuyerCancelled);
        vm.prank(router);
        vm.expectRevert(InferenceMarket.OrderNotReserved.selector);
        market.settle(REQUEST, _usage(), InferenceMarket.Outcome.SellerFailed);
        vm.warp(block.timestamp + 301);
        vm.prank(buyer);
        vm.expectRevert(InferenceMarket.OrderNotReserved.selector);
        market.reclaimExpired(REQUEST);
        vm.prank(router);
        vm.expectRevert(InferenceMarket.RequestAlreadyExists.selector);
        market.reserve(REQUEST, buyer, provider, MODEL, UNIT, uint64(block.timestamp + 300), 1);
        _assertAccounting();
    }

    function testReclaimedOrderCannotBeChargedOrReclaimedTwice() public {
        _reserve(REQUEST, UNIT);
        vm.warp(market.getOrder(REQUEST).deadline);
        vm.prank(buyer);
        market.reclaimExpired(REQUEST);
        vm.prank(router);
        vm.expectRevert(InferenceMarket.OrderNotReserved.selector);
        market.settle(REQUEST, _usage(), InferenceMarket.Outcome.Success);
        vm.prank(buyer);
        vm.expectRevert(InferenceMarket.OrderNotReserved.selector);
        market.reclaimExpired(REQUEST);
        _assertAccounting();
    }

    function testOnlyRouterCanReserveOrSettle() public {
        vm.prank(buyer);
        vm.expectRevert(InferenceMarket.Unauthorized.selector);
        market.reserve(REQUEST, buyer, provider, MODEL, UNIT, uint64(block.timestamp + 300), 1);
        _reserve(REQUEST, UNIT);
        vm.prank(provider);
        vm.expectRevert(InferenceMarket.Unauthorized.selector);
        market.settle(REQUEST, _usage(), InferenceMarket.Outcome.Success);
    }

    function testStrangerCannotGrantOrRevokeAnotherBuyersAuthority() public {
        vm.startPrank(stranger);
        market.authorizeRouter(UNIT, uint64(block.timestamp + 100));
        market.revokeRouter();
        vm.stopPrank();
        assertFalse(market.getGrant(buyer, 1).revoked);
        assertEq(market.getGrant(buyer, 1).totalLimit, 10 * UNIT);
    }

    function testInvalidGrantsAndNoGrantAreRejected() public {
        vm.expectRevert(InferenceMarket.InvalidAmount.selector);
        market.authorizeRouter(0, uint64(block.timestamp + 1));
        vm.expectRevert(InferenceMarket.InvalidExpiry.selector);
        market.authorizeRouter(UNIT, uint64(block.timestamp));
        vm.prank(stranger);
        vm.expectRevert(InferenceMarket.GrantUnavailable.selector);
        market.revokeRouter();
        vm.prank(router);
        vm.expectRevert(InferenceMarket.GrantUnavailable.selector);
        market.reserve(REQUEST, stranger, provider, MODEL, UNIT, uint64(block.timestamp + 300), 1);
    }

    function testReserveRequiresBoundedFutureDeadlineOpaqueIdAndPositiveBudget() public {
        vm.startPrank(router);
        vm.expectRevert(InferenceMarket.InvalidDeadline.selector);
        market.reserve(REQUEST, buyer, provider, MODEL, UNIT, uint64(block.timestamp), 1);
        vm.expectRevert(InferenceMarket.InvalidDeadline.selector);
        market.reserve(REQUEST, buyer, provider, MODEL, UNIT, uint64(block.timestamp + 3601), 1);
        vm.expectRevert(InferenceMarket.InvalidRequestId.selector);
        market.reserve(bytes32(0), buyer, provider, MODEL, UNIT, uint64(block.timestamp + 300), 1);
        vm.expectRevert(InferenceMarket.InvalidAmount.selector);
        market.reserve(REQUEST, buyer, provider, MODEL, 0, uint64(block.timestamp + 300), 1);
        vm.expectRevert(InferenceMarket.InvalidAddress.selector);
        market.reserve(REQUEST, address(0), provider, MODEL, UNIT, uint64(block.timestamp + 300), 1);
        vm.stopPrank();
    }

    function testProviderCanWithdrawEarningsAndDirectDonationsDoNotCreateLiabilities() public {
        _reserve(REQUEST, UNIT);
        _settle(REQUEST, _usage(), InferenceMarket.Outcome.Success);
        vm.prank(provider);
        market.withdraw(4_800);
        assertEq(usd.balanceOf(provider), 4_800);
        assertEq(market.balances(provider), 0);
        _assertAccounting();
        vm.prank(buyer);
        usd.transfer(address(market), UNIT);
        assertEq(usd.balanceOf(address(market)), market.totalEscrowed() + UNIT);
    }

    function testInvalidConstructorTokenOrRouterRejected() public {
        vm.expectRevert(InferenceMarket.InvalidAddress.selector);
        new InferenceMarket(address(0), router);
        vm.expectRevert(InferenceMarket.InvalidAddress.selector);
        new InferenceMarket(address(usd), address(0));
        vm.expectRevert(InferenceMarket.InvalidAddress.selector);
        new InferenceMarket(stranger, router);
        ERC20 wrongDecimals = new WrongDecimalsToken();
        vm.expectRevert(InferenceMarket.InvalidTokenDecimals.selector);
        new InferenceMarket(address(wrongDecimals), router);
    }

    function testFuzzChargeMatchesReferenceAcrossAllFourCategories(
        uint64 a,
        uint64 b,
        uint64 c,
        uint64 d,
        uint64 w,
        uint64 x,
        uint64 y,
        uint64 z
    ) public view {
        uint256 numerator = uint256(a) * w + uint256(b) * x + uint256(c) * y + uint256(d) * z;
        uint256 expected = numerator / UNIT + (numerator % UNIT == 0 ? 0 : 1);
        assertEq(
            market.calculateCharge(InferenceMarket.Prices(a, b, c, d), InferenceMarket.Usage(w, x, y, z)), expected
        );
    }

    function testFuzzTerminalFeeNeverExceedsReserveAndPreservesFunds(uint256 rawOutput, uint8 rawOutcome) public {
        uint256 output = bound(rawOutput, 0, 125_000);
        InferenceMarket.Outcome outcome = InferenceMarket.Outcome(bound(rawOutcome, 0, 4));
        _reserve(REQUEST, UNIT);
        _settle(REQUEST, InferenceMarket.Usage(0, 0, 0, output), outcome);
        uint256 expected = uint256(outcome) >= 3 ? 0 : output * 8;
        assertEq(market.getOrder(REQUEST).charged, expected);
        assertLe(expected, UNIT);
        assertEq(market.balances(provider), expected);
        _assertAccounting();
    }

    function testFuzzConcurrentLimits(uint256 rawFirst, uint256 rawSecond) public {
        uint256 first = bound(rawFirst, UNIT / 10, 10 * UNIT);
        uint256 second = bound(rawSecond, UNIT / 10, 10 * UNIT);
        _reserve(REQUEST, first);
        if (first + second > 10 * UNIT) {
            vm.prank(router);
            vm.expectRevert(InferenceMarket.GrantLimitExceeded.selector);
            market.reserve(bytes32(uint256(2)), buyer, provider, MODEL, second, uint64(block.timestamp + 300), 1);
        } else {
            _reserve(bytes32(uint256(2)), second);
        }
        assertLe(market.getGrant(buyer, 1).locked, 10 * UNIT);
        _assertAccounting();
    }
}

/// @dev Randomized real lifecycle transitions, including grants replaced with orders still in flight.
contract MarketHandler is Test {
    InferenceMarket public market;
    DemoUSD public usd;
    address public buyer;
    address public provider;
    address public router;
    bytes32 public constant MODEL = keccak256("invariant-model");
    bytes32[] public ids;

    constructor(InferenceMarket market_, DemoUSD usd_, address buyer_, address provider_, address router_) {
        market = market_;
        usd = usd_;
        buyer = buyer_;
        provider = provider_;
        router = router_;
    }

    function reserve(uint256 rawAmount) external {
        if (ids.length >= 64) return;
        InferenceMarket.Grant memory grant = market.getGrant(buyer, market.activeGrantId(buyer));
        if (grant.revoked || grant.expiresAt <= block.timestamp) return;
        uint256 available = grant.totalLimit - grant.spent - grant.locked;
        if (available > market.balances(buyer)) available = market.balances(buyer);
        if (available == 0) return;
        uint256 amount = bound(rawAmount, 1, available);
        bytes32 id = bytes32(ids.length + 1);
        vm.prank(router);
        market.reserve(id, buyer, provider, MODEL, amount, uint64(block.timestamp + 60), 1);
        ids.push(id);
    }

    function settle(uint256 rawIndex, uint8 rawOutcome, uint256 rawFee) external {
        if (ids.length == 0) return;
        bytes32 id = ids[rawIndex % ids.length];
        InferenceMarket.Order memory order = market.getOrder(id);
        if (order.state != InferenceMarket.OrderState.Reserved || block.timestamp >= order.deadline) return;
        uint256 fee = bound(rawFee, 0, order.reserved);
        InferenceMarket.Outcome outcome = InferenceMarket.Outcome(rawOutcome % 5);
        vm.prank(router);
        market.settle(id, InferenceMarket.Usage(0, 0, 0, fee), outcome);
    }

    function reclaim(uint256 rawIndex) external {
        if (ids.length == 0) return;
        bytes32 id = ids[rawIndex % ids.length];
        InferenceMarket.Order memory order = market.getOrder(id);
        if (order.state != InferenceMarket.OrderState.Reserved) return;
        if (block.timestamp < order.deadline) vm.warp(order.deadline);
        vm.prank(buyer);
        market.reclaimExpired(id);
    }

    function replaceGrant(uint256 rawLimit) external {
        if (market.activeGrantId(buyer) >= 64) return;
        vm.prank(buyer);
        market.authorizeRouter(bound(rawLimit, 1, 1_000 * 1e6), uint64(block.timestamp + 600));
    }

    function revoke() external {
        vm.prank(buyer);
        market.revokeRouter();
    }

    function withdraw(uint256 rawAmount, bool isProvider) external {
        address account = isProvider ? provider : buyer;
        uint256 available = market.balances(account);
        if (available == 0) return;
        vm.prank(account);
        market.withdraw(bound(rawAmount, 1, available));
    }

    function deposit(uint256 rawAmount) external {
        uint256 available = usd.balanceOf(buyer);
        if (available == 0) return;
        vm.prank(buyer);
        market.deposit(bound(rawAmount, 1, available));
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }
}

contract InferenceMarketInvariantTest is Test {
    DemoUSD internal usd;
    InferenceMarket internal market;
    MarketHandler internal handler;
    address internal buyer = address(0xB001);
    address internal provider = address(0xA001);
    address internal router = address(0xC001);

    function setUp() public {
        vm.warp(1_000_000);
        usd = new DemoUSD();
        market = new InferenceMarket(address(usd), router);
        vm.startPrank(buyer);
        usd.faucet();
        usd.approve(address(market), type(uint256).max);
        market.deposit(100 * 1e6);
        market.authorizeRouter(10 * 1e6, uint64(block.timestamp + 600));
        vm.stopPrank();
        vm.prank(provider);
        market.upsertQuote(keccak256("invariant-model"), InferenceMarket.Prices(0, 0, 0, 1e6), 0, true);
        handler = new MarketHandler(market, usd, buyer, provider, router);
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = handler.reserve.selector;
        selectors[1] = handler.settle.selector;
        selectors[2] = handler.reclaim.selector;
        selectors[3] = handler.replaceGrant.selector;
        selectors[4] = handler.revoke.selector;
        selectors[5] = handler.withdraw.selector;
        selectors[6] = handler.deposit.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
        targetContract(address(handler));
    }

    function invariantAllLiabilitiesAreFullyBacked() public view {
        assertEq(market.balances(buyer) + market.balances(provider) + market.totalLocked(), market.totalEscrowed());
        assertEq(usd.balanceOf(address(market)), market.totalEscrowed());
    }

    function invariantEveryGrantStaysWithinItsOwnLimit() public view {
        uint256 locks;
        for (uint256 i = 1; i <= market.activeGrantId(buyer); i++) {
            InferenceMarket.Grant memory grant = market.getGrant(buyer, i);
            assertLe(grant.spent + grant.locked, grant.totalLimit);
            locks += grant.locked;
        }
        assertEq(locks, market.totalLocked());
    }

    function invariantOrderLocksAndFinalFeesAgreeWithAccounting() public view {
        uint256 locks;
        uint256 fees;
        for (uint256 i = 0; i < handler.idsLength(); i++) {
            InferenceMarket.Order memory order = market.getOrder(handler.ids(i));
            assertLe(order.charged, order.reserved);
            if (order.state == InferenceMarket.OrderState.Reserved) locks += order.reserved;
            if (uint256(order.outcome) >= 3) assertEq(order.charged, 0);
            fees += order.charged;
        }
        assertEq(locks, market.totalLocked());
        assertEq(fees, market.balances(provider) + usd.balanceOf(provider));
    }
}
