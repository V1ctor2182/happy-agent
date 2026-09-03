# Slash commands module

`SlashCommandsModule` merges the ordered command definitions returned by its contributing modules.
It keeps the owner and optional image bytes private while exposing lightweight public descriptors,
refreshes discovery when agents start and turns begin, and records a complete replacement event
when either descriptors or image content change.

```text
Compactions ─────┐
Native workflows ├─> SlashCommandsModule ─> API catalog, events, image bytes
Skills ──────────┘              │
                                └─> direct invocation on the owning module
```

Names must be unique except for one deliberate precedence rule: an installed skill replaces a
same-named workflow alias. Skills also displace workflow aliases if the complete catalog reaches
the protocol's entry bound. Every other duplicate or overflow is rejected as a module error.

Invocation always refreshes first, resolves the command's owning module, and calls that module's
public `invokeSlashCommand` operation directly. Invocation does not reinterpret the selected
command.
