# 05 — Project-local Claude Code skill (portable)

## Introduction

The CLI for querying the archive lives as a Claude Code skill at
`.claude/skills/line-inbox/`. Two design constraints shaped it:

1. The skill must work in *this* repo and from a *separate* repo
   (`~/Mail`) that also wants to query the archive.
2. The user has another Turso project's credentials globally exported
   in their shell. Naive env-var lookup would silently route queries
   to the wrong DB.

## Methods

The skill is structured per Claude Code conventions:

```
.claude/skills/line-inbox/
├── .env             ← Turso pair, gitignored
├── .gitignore       ← excludes .env + __pycache__/
├── SKILL.md         ← frontmatter + 4-line invocation guide
├── references/schema.md
└── scripts/inbox.py ← stdlib-only, self-locating via __file__
```

`inbox.py` resolves credentials in this precedence:

1. `LINE_INBOX_ENV=/path/to/.env` (explicit override)
2. **Skill-local `.env`** at `${CLAUDE_SKILL_DIR}/.env` (resolved via `__file__`)
3. Project `.env` at `/Users/htlin/lizard-the-linebot/.env` (fallback)
4. Shell env vars (last resort)

**Files always win over env vars** because of constraint #2 — reading
`os.environ['TURSO_DATABASE_URL']` first would hit the unrelated
`prompt-polish-htlin222.turso.io` instance the user has exported
globally, and the first symptom would be `no such table: messages`
(seen during initial smoke test on the unfixed code).

Verification of the precedence: temporarily renamed the project
`.env` aside, ran `inbox.py count`, confirmed it still returned the
right rows (proof the skill-local `.env` was loaded), then restored.

For cross-repo use, the skill in `~/Mail` is an absolute symlink:

```
~/Mail/.claude/skills/line-inbox -> /Users/htlin/lizard-the-linebot/.claude/skills/line-inbox
```

`~/Mail/.gitignore` line 18 excludes the path so git doesn't try to
commit a machine-specific symlink target.

## Results

- `git check-ignore -v .env` confirms the skill-local `.gitignore` masks the file in any consuming repo.
- Token leak check (`git diff --cached | grep -F "$TOKEN_PREFIX"`) before each commit returns 0 hits — verified across all skill commits (`1b3196e`, `f027ca1`, `41f8366`).
- Same `inbox.py` invocation works identically from `/Users/htlin/lizard-the-linebot/` and `/Users/htlin/Mail/`; mtime + SHA on both paths match (confirms the symlink is live, not a stale copy).

## Discussion

Symlink-as-mirror is the right call for a one-user, one-machine
mirror. Trade-offs we accepted:

- **Absolute target** breaks if either repo moves. Acceptable — both
  paths are stable user-home subdirectories.
- **No version pinning** between the two repos. If `inbox.py`
  develops a bug, both repos see the bug instantly. Acceptable, and
  arguably desirable — the alternative (manual sync) would drift.
- **Mail commits get a constant `??` line** without the gitignore
  entry, easy to forget. We added a comment next to the gitignore line
  explaining the symlink intent so future-self doesn't remove it.

What we didn't do: package the skill as an npm/pip distributable.
That would be the right move for a multi-user skill, but for "one
user, two machines, maybe" it's just ceremony.

Anti-patterns we steered away from:

- Putting credentials inside `SKILL.md` (would commit them).
- Symlinking *files* inside the skill folder rather than the whole
  folder (the parts can drift independently — better to symlink the
  unit).
- Reading `~/.netrc`-style global config (creates yet another
  precedence question).
