# Vendored Solidity dependencies

These directories were extracted from official, fixed-version GitHub release-tag archives. They are normal vendored files, not Git submodules. No runtime CDN or floating branch dependency is required to compile.

| Library | Version | Source archive | Archive SHA-256 |
| --- | --- | --- | --- |
| OpenZeppelin Contracts | v5.4.0 | https://github.com/OpenZeppelin/openzeppelin-contracts/archive/refs/tags/v5.4.0.tar.gz | `b89829be48bc501051002191733268a93ef6e238a4bb65d8fd1cbdf3969050d1` |
| Foundry forge-std | v1.9.7 | https://github.com/foundry-rs/forge-std/archive/refs/tags/v1.9.7.tar.gz | `45157353ab49eab01d294565866731e599b32401757229689ee459aa26b7ee94` |

Licenses and upstream source files are retained in the respective directories. The contract source uses OpenZeppelin ERC20/ERC20Capped, SafeERC20, Math, and ReentrancyGuard. The test suite uses forge-std.
