# Design: Change Default Theme to Light

**Date:** 2026-05-03  
**Status:** Approved

## Summary

Change the project's fallback theme from `dark` to `light` so that new users who have no saved theme preference in localStorage see the GitHub Light-inspired theme by default.

## Motivation

The current default is `dark`. The team wants new users to encounter a light, bright UI out of the box.

## Scope

Two JavaScript string literals need to be changed. No CSS, no types, no new files.

## Changes

| File | Line | Before | After |
|------|------|--------|-------|
| `index.html` | 14 | `\|\| 'dark'` | `\|\| 'light'` |
| `src/App.tsx` | 329 | `\|\| 'dark'` | `\|\| 'light'` |

## Behavior

- **New users** (no `app-theme-v2` in localStorage): see `light` theme by default.
- **Existing users** (have `app-theme-v2` saved): unaffected — their saved preference is loaded as-is.
- **Flash prevention**: `index.html` inline script runs synchronously before first paint; changing its fallback to `'light'` prevents any dark-flash for new users.
- **React state**: `App.tsx` useState initializer also falls back to `'light'`, keeping React state in sync with the DOM attribute.

## Out of Scope

- No changes to CSS variables or `:root` defaults.
- No changes to theme type definitions.
- No changes to existing users' stored preferences.
