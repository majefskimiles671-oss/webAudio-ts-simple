
## Notes

Goal (simple)
Show how to:

write/read files in OPFS (browser)
sync files to/from the local filesystem (Node)
keep responsibilities clean
move bytes only across the boundary

That’s it.

---

fs_bridge_proper_demo/
├─ src/
│  ├─ server.ts
│  ├─ fsBackend.ts
│  └─ public/
│     ├─ index.html
│     └─ browser.ts
├─ dist/
├─ package.json
└─ tsconfig.json

---
fs_bridge_proper_demo/
├─ src/
│  ├─ server.ts          # Express + bridge endpoints
│  ├─ fsBackend.ts       # Local filesystem authority
│  └─ public/
│       ├─ index.html    # Minimal UI
│       └─ browser.ts    # OPFS + bridge client
├─ dist/
├─ package.json
└─ tsconfig.json

---


