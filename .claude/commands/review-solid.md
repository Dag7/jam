Review $ARGUMENTS for SOLID principle violations and design pattern opportunities.

Check for:

**S — Single Responsibility:**
- Does the file/class have more than one reason to change?
- Are there mixed concerns (UI + business logic, IO + parsing, etc.)?

**O — Open/Closed:**
- Are there if/else or switch chains that would need modification to extend?
- Could these be replaced with registries, strategy maps, or polymorphism?

**L — Liskov Substitution:**
- Do subclasses properly substitute for their base types?
- Are there type guards or instanceof checks that violate substitutability?

**I — Interface Segregation:**
- Are interfaces minimal and focused?
- Do consumers depend on methods they don't use?

**D — Dependency Inversion:**
- Does the module depend on abstractions or concretions?
- Are dependencies injected or hard-coded?

Also check for:
- Direct instantiation instead of injection
- Module-level mutable state
- Duplicated logic that should be extracted
- Security issues (string interpolation in shell commands, unsanitized user input)
- God objects that receive the whole orchestrator instead of narrow deps

Report findings with file paths and line numbers, and suggest concrete fixes using project patterns (BaseAgentRuntime, OutputStrategy, handler dep interfaces, CommandRouter registry).
