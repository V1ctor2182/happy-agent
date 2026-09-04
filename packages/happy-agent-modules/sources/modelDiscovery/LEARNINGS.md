# Model discovery learnings

## The picker must not wait for a source edit

A hardcoded catalog meant a model the vendor shipped after the build, such as GPT-6-Astra, was
invisible until someone edited `agentCatalog.ts` and shipped the daemon, even though the Codex CLI
on the same machine already listed it. The daemon now asks each signed-in Codex and Claude account
what it serves, in the background after startup and on a timer, and configuration appends those
routes behind the curated ones. The curated catalog remains the place for hand-checked wire
details, and it wins whenever it and a listing name the same ID.

## Discovered Claude routes keep the vendor's ID

The daemon consumes the published provider package, which maps only the curated `anthropic/…`
aliases and hands any other ID to Claude Code unchanged. A discovered `anthropic/mythos-5-1` would
therefore never run, while `claude-mythos-5-1` does. Discovered Claude routes are offered under
the vendor ID for that reason, and a listing entry that is a dated snapshot of a curated model is
treated as that curated model rather than doubled.

## A failed listing never empties the picker

The last discovered answer is durable in `discovered-models.json`. A request that cannot be made
or fails records why for `list()` and changes nothing, and Codex falls back to the CLI's own
cache of the same catalog before giving up. An isolated account only reads the cache beside its
own auth file; the machine's Codex home is ambient state it was told not to touch.
