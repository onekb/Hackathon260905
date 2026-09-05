// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Test-asset escrow for a marketplace whose router is trusted to meter usage and assign fault.
/// @dev The chain enforces prices, budgets, grants and refunds. It cannot verify model identity or usage.
///      Requests and responses MUST stay off chain; IDs must be opaque, non-content-derived values.
contract InferenceMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant TOKENS_PER_MILLION = 1_000_000;
    uint64 public constant MAX_ORDER_DURATION = 1 hours;

    enum Outcome {
        Success,
        BuyerCancelled,
        BudgetCapped,
        SellerFailed,
        PlatformFailed
    }

    enum OrderState {
        None,
        Reserved,
        Settled,
        Reclaimed
    }

    /// @dev Each rate is denominated in 6-decimal token units per million inference tokens.
    struct Prices {
        uint256 input;
        uint256 cacheRead;
        uint256 cacheWrite;
        uint256 output;
    }

    /// @dev Input, cacheRead and cacheWrite are disjoint categories, not overlapping totals.
    struct Usage {
        uint256 input;
        uint256 cacheRead;
        uint256 cacheWrite;
        uint256 output;
    }

    struct Quote {
        Prices prices;
        uint256 minReserve;
        uint64 version;
        bool active;
    }

    struct QuoteKey {
        address provider;
        bytes32 modelId;
    }

    struct Grant {
        uint256 totalLimit;
        uint256 spent;
        uint256 locked;
        uint64 expiresAt;
        bool revoked;
    }

    struct Order {
        address buyer;
        address provider;
        bytes32 modelId;
        uint256 reserved;
        uint256 charged;
        uint256 grantId;
        uint64 deadline;
        uint64 quoteVersion;
        OrderState state;
        Outcome outcome;
        Prices prices;
        Usage usage;
    }

    IERC20 public immutable token;
    address public immutable router;
    mapping(address account => uint256) public balances;
    mapping(address buyer => uint256) public activeGrantId;
    uint256 public totalLocked;
    uint256 public totalEscrowed;

    mapping(address provider => mapping(bytes32 modelId => Quote)) private _quotes;
    QuoteKey[] private _quoteKeys;
    mapping(address buyer => mapping(uint256 grantId => Grant)) private _grants;
    mapping(bytes32 requestId => Order) private _orders;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidTokenDecimals();
    error UnsupportedTokenTransfer();
    error Unauthorized();
    error InvalidModelId();
    error InvalidRequestId();
    error QuoteUnavailable();
    error QuoteVersionMismatch();
    error BelowMinimumReserve();
    error InvalidExpiry();
    error InvalidDeadline();
    error GrantUnavailable();
    error GrantLimitExceeded();
    error InsufficientBalance();
    error RequestAlreadyExists();
    error OrderNotReserved();
    error SettlementExpired();
    error OrderNotExpired();
    error BudgetExceeded();

    event QuoteUpdated(
        address indexed provider,
        bytes32 indexed modelId,
        uint64 version,
        Prices prices,
        uint256 minReserve,
        bool active
    );
    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event RouterAuthorized(address indexed buyer, uint256 indexed grantId, uint256 totalLimit, uint64 expiresAt);
    event RouterRevoked(address indexed buyer, uint256 indexed grantId);
    event OrderReserved(
        bytes32 indexed requestId,
        address indexed buyer,
        address indexed provider,
        bytes32 modelId,
        uint256 reserved,
        uint256 grantId,
        uint64 deadline,
        uint64 quoteVersion
    );
    event OrderSettled(
        bytes32 indexed requestId,
        address indexed buyer,
        address indexed provider,
        Outcome outcome,
        uint256 charged,
        uint256 released,
        Usage usage
    );
    event OrderReclaimed(bytes32 indexed requestId, address indexed buyer, uint256 released);

    modifier onlyRouter() {
        if (msg.sender != router) revert Unauthorized();
        _;
    }

    constructor(address token_, address router_) {
        if (token_ == address(0) || router_ == address(0) || token_.code.length == 0) revert InvalidAddress();
        if (IERC20Metadata(token_).decimals() != 6) revert InvalidTokenDecimals();
        token = IERC20(token_);
        router = router_;
    }

    /// @notice The wallet publishing a quote is its provider and receives the resulting fees.
    function upsertQuote(bytes32 modelId, Prices calldata prices, uint256 minReserve, bool active) external {
        if (modelId == bytes32(0)) revert InvalidModelId();
        Quote storage quote = _quotes[msg.sender][modelId];
        if (quote.version == 0) _quoteKeys.push(QuoteKey(msg.sender, modelId));
        quote.prices = prices;
        quote.minReserve = minReserve;
        quote.version += 1;
        quote.active = active;
        emit QuoteUpdated(msg.sender, modelId, quote.version, prices, minReserve, active);
    }

    function quoteCount() external view returns (uint256) {
        return _quoteKeys.length;
    }

    function quoteAt(uint256 index) external view returns (address provider, bytes32 modelId, Quote memory quote) {
        QuoteKey memory key = _quoteKeys[index];
        return (key.provider, key.modelId, _quotes[key.provider][key.modelId]);
    }

    function getQuote(address provider, bytes32 modelId) external view returns (Quote memory) {
        return _quotes[provider][modelId];
    }

    function getGrant(address buyer, uint256 grantId) external view returns (Grant memory) {
        return _grants[buyer][grantId];
    }

    function getOrder(bytes32 requestId) external view returns (Order memory) {
        return _orders[requestId];
    }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert UnsupportedTokenTransfer();
        balances[msg.sender] += amount;
        totalEscrowed += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Only the balance owner can withdraw; router grants never confer withdrawal rights.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (balances[msg.sender] < amount) revert InsufficientBalance();
        balances[msg.sender] -= amount;
        totalEscrowed -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Creates a new spending grant, replacing the previous grant for NEW requests only.
    /// @dev Each grant is a separate wallet-authorized allowance. Old in-flight orders retain their
    ///      original grant and may finish; their settlement never mutates a replacement grant.
    function authorizeRouter(uint256 totalLimit, uint64 expiresAt) external returns (uint256 grantId) {
        if (totalLimit == 0) revert InvalidAmount();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        uint256 previous = activeGrantId[msg.sender];
        if (previous != 0 && !_grants[msg.sender][previous].revoked) {
            _grants[msg.sender][previous].revoked = true;
            emit RouterRevoked(msg.sender, previous);
        }
        grantId = previous + 1;
        activeGrantId[msg.sender] = grantId;
        _grants[msg.sender][grantId] = Grant(totalLimit, 0, 0, expiresAt, false);
        emit RouterAuthorized(msg.sender, grantId, totalLimit, expiresAt);
    }

    function revokeRouter() external {
        uint256 grantId = activeGrantId[msg.sender];
        if (grantId == 0) revert GrantUnavailable();
        _grants[msg.sender][grantId].revoked = true;
        emit RouterRevoked(msg.sender, grantId);
    }

    function reserve(
        bytes32 requestId,
        address buyer,
        address provider,
        bytes32 modelId,
        uint256 maxSpend,
        uint64 deadline,
        uint64 expectedQuoteVersion
    ) external onlyRouter {
        if (requestId == bytes32(0)) revert InvalidRequestId();
        if (_orders[requestId].state != OrderState.None) revert RequestAlreadyExists();
        if (buyer == address(0) || provider == address(0)) revert InvalidAddress();
        if (maxSpend == 0) revert InvalidAmount();
        if (deadline <= block.timestamp || deadline > block.timestamp + MAX_ORDER_DURATION) revert InvalidDeadline();
        Quote storage quote = _quotes[provider][modelId];
        if (!quote.active) revert QuoteUnavailable();
        if (quote.version != expectedQuoteVersion) revert QuoteVersionMismatch();
        if (maxSpend < quote.minReserve) revert BelowMinimumReserve();
        uint256 grantId = activeGrantId[buyer];
        Grant storage grant = _grants[buyer][grantId];
        if (grantId == 0 || grant.revoked || grant.expiresAt <= block.timestamp) revert GrantUnavailable();
        if (maxSpend > grant.totalLimit - grant.spent - grant.locked) revert GrantLimitExceeded();
        if (balances[buyer] < maxSpend) revert InsufficientBalance();

        balances[buyer] -= maxSpend;
        grant.locked += maxSpend;
        totalLocked += maxSpend;

        Order storage order = _orders[requestId];
        order.buyer = buyer;
        order.provider = provider;
        order.modelId = modelId;
        order.reserved = maxSpend;
        order.grantId = grantId;
        order.deadline = deadline;
        order.quoteVersion = quote.version;
        order.state = OrderState.Reserved;
        order.prices = quote.prices;
        emit OrderReserved(requestId, buyer, provider, modelId, maxSpend, grantId, deadline, quote.version);
    }

    /// @notice Calculate ceil(sum(rate * quantity) / 1e6), rounding ONCE across all categories.
    /// @dev Full-precision multiplication avoids intermediate overflow. Impossible total charges revert.
    function calculateCharge(Prices memory prices, Usage memory usage) public pure returns (uint256) {
        uint256 whole = Math.mulDiv(prices.input, usage.input, TOKENS_PER_MILLION)
            + Math.mulDiv(prices.cacheRead, usage.cacheRead, TOKENS_PER_MILLION)
            + Math.mulDiv(prices.cacheWrite, usage.cacheWrite, TOKENS_PER_MILLION)
            + Math.mulDiv(prices.output, usage.output, TOKENS_PER_MILLION);
        uint256 remainder = mulmod(prices.input, usage.input, TOKENS_PER_MILLION)
            + mulmod(prices.cacheRead, usage.cacheRead, TOKENS_PER_MILLION)
            + mulmod(prices.cacheWrite, usage.cacheWrite, TOKENS_PER_MILLION)
            + mulmod(prices.output, usage.output, TOKENS_PER_MILLION);
        return whole + Math.ceilDiv(remainder, TOKENS_PER_MILLION);
    }

    function settle(bytes32 requestId, Usage calldata usage, Outcome outcome) external onlyRouter {
        Order storage order = _orders[requestId];
        if (order.state != OrderState.Reserved) revert OrderNotReserved();
        if (block.timestamp >= order.deadline) revert SettlementExpired();
        uint256 charged = 0;
        if (outcome != Outcome.SellerFailed && outcome != Outcome.PlatformFailed) {
            charged = calculateCharge(order.prices, usage);
            if (charged > order.reserved) revert BudgetExceeded();
        }

        order.state = OrderState.Settled;
        order.outcome = outcome;
        order.usage = usage;
        order.charged = charged;
        _release(order, charged);
        emit OrderSettled(requestId, order.buyer, order.provider, outcome, charged, order.reserved - charged, usage);
    }

    /// @notice At/after the deadline, the buyer can recover the full reservation without the router.
    function reclaimExpired(bytes32 requestId) external {
        Order storage order = _orders[requestId];
        if (order.state != OrderState.Reserved) revert OrderNotReserved();
        if (msg.sender != order.buyer) revert Unauthorized();
        if (block.timestamp < order.deadline) revert OrderNotExpired();
        order.state = OrderState.Reclaimed;
        order.outcome = Outcome.PlatformFailed;
        _release(order, 0);
        emit OrderReclaimed(requestId, order.buyer, order.reserved);
    }

    function _release(Order storage order, uint256 charged) private {
        Grant storage grant = _grants[order.buyer][order.grantId];
        grant.locked -= order.reserved;
        grant.spent += charged;
        totalLocked -= order.reserved;
        balances[order.buyer] += order.reserved - charged;
        balances[order.provider] += charged;
    }
}
