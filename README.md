# webAudio-ts-simple
Simple web audio example that will eventually record and play back audio in the browser.

## OPFS
 - current project audio/etc. storage
 - this will be the size limit of current project media size (Possibly the ftp source could load directly 
    into memory without mirroring the media files in browser storage)

## FTP server
 - big audio storage

## BroadcastChannels
 - communication between tabs

## Single page apps
 - 2 or more SPA's that run simultaneously and independently in tabs of the same browser.
 - they all share the Local and Big storage.

## Shared WebWorkers
 - load all the files in the project from the FTP to the OPFS (and create peak files?)

## SQLite database
 - holds references to all the audio files and where they are in the big audio storage






