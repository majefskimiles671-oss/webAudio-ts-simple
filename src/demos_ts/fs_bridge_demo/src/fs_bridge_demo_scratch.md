
## Notes
 - write a file to sftp using typescript
    - setup sftp server
    - get typescript lib or code for sftp
    - make a file and put it in the sftp location


┌──────────────────────────────┐
│ Your Terminal (SFTP client)  │
│                              │
│  LOCAL FS                    │
│  lpwd → ~/demo-local         │
│  lls                         │
│                              │
│      put / get               │
│           ⇵                  │
│  REMOTE FS                   │
│  pwd → ~/sftp-root           │
│  ls                          │
│                              │
│ SSH/SFTP server (localhost)  │
└──────────────────────────────┘
Why This Is Actually a Good Fit for Your App
Your demo app is implicitly doing the same thing:

Concept           RoleBrowser
OPFS              “local” (producer/consumer)
SFTP server       “remote” (authoritative store)

The Two Roles (Even on One Machine)
Think in terms of perspective, not hardware.
Local side

The process you launched in Terminal
The filesystem your SFTP client reads from
Where put reads files from
Commands:

lpwd
lls
lcd



Remote side

The SSH/SFTP server
The filesystem SFTP writes to
Where put writes files to
Commands:

pwd
ls
cd



Even though:

both roles are on your laptop
both resolve to /Users/you/...

they are still distinct roles in the protocol.

 - save a file to OFPS

 ---

 
