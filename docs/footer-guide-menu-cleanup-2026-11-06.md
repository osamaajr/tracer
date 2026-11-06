# Footer guide menu cleanup — 6 November 2026

The user reported that the “After Carted” menu entry did not work and authorised fixing or removing it. Removed that entry from the shared React footer and the saved-products guide footer. The two remaining guide links, styling and article content are unchanged. The Carted article remains available at its existing direct URL.

All three guide URLs returned HTTP 200 with their expected article titles/headings during investigation; the reported menu interaction failure was not reproduced by direct requests. Removing the optional entry avoids that menu path without changing routing or other links.

The website type check and production build pass. Source and built output contain no “After Carted” menu label. Both remaining guide paths map to real built HTML files with the correct content. The full extension regression run also passed all 332 tests, workspace type checks, lint and the existing monitoring fixture. No extension package or version changes are required for this footer edit.
