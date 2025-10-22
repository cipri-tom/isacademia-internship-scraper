# Coding Preferences and Style Guide

## Code Simplicity
- **Keep it simple**: Always prefer the simplest solution that works
- **Avoid over-engineering**: Don't add abstractions or complexity unless absolutely necessary
- **Question complexity**: If code feels convoluted, it probably is - simplify it

## Code Quality
- **No duplication**: Extract duplicated logic into helper functions
- **Direct approach**: Prefer straightforward solutions over clever ones
- **Minimal refactoring**: Only refactor what's necessary; don't change working code unnecessarily

## Performance & Optimization
- **Optimize early when obvious**: If a clear performance issue exists, address it proactively
- **Check before doing**: When working with external resources, check what already exists before performing expensive operations
- **Query first, process later**: Read existing state upfront to avoid redundant work

## Data Structures
- **Preserve existing data**: When modifying files/databases, merge new data with existing rather than replacing
- **Choose appropriately**: Use the simplest data structure that fits (arrays for ordered collections, Sets for deduplication, Maps for lookups)
- **Don't convert unnecessarily**: If you need an array at the end, don't convert to Map and back

## Code Review Feedback
- **Show all changes at once**: When refactoring involves multiple related changes, present the complete solution
- **Address overlap proactively**: If there's significant code duplication (>70-80%), extract common logic immediately
- **Talk through approaches**: Discuss significant refactoring approaches before implementing
- **Explain the "why"**: When suggesting changes, explain the reasoning and trade-offs
- **Iterative refinement**: Be open to multiple rounds of feedback to get it right

## Communication
- **Be concise**: Keep explanations brief and to the point
- **Show don't tell**: Demonstrate with code examples when possible
- **Respect existing patterns**: Follow the established code style and patterns in the project
