# Third-party components

mABBAJACK itself is released under the MIT License (see `LICENSE`).
The standalone app bundles the following programs, each under its own license.
Their license texts are in `mABBAJACK.app/Contents/Resources/payload/licenses/`.

| Component | Use | License | Source |
|---|---|---|---|
| Node.js 24 | runs the local server | MIT | https://nodejs.org |
| 7-Zip (`7zz`) 26.04 | archive extraction | GNU LGPL 2.1 + unRAR restriction | https://www.7-zip.org |
| unar 1.10.8 (XADMaster) | RAR fallback extraction | GNU LGPL 2.1 | https://github.com/MacPaw/XADMaster |
| DirectXTex (`texconv`) | texture conversion | MIT | https://github.com/microsoft/DirectXTex |
| pywebview | native window | BSD-3-Clause | https://github.com/r0x0r/pywebview |
| Python (PyInstaller runtime) | launcher | PSF License | https://www.python.org |
| Express, cors, multer, jszip, xxhash-wasm | server libraries | MIT / ISC | npm |
| React, lucide-react | user interface | MIT / ISC | npm |

7-Zip and unar are unmodified builds of the official sources, compiled for macOS 13+
(`scripts/build_portable_tools.sh`). unRAR restriction: the RAR decompression code may not be
used to recreate the RAR compression algorithm.

mABBAJACK is not affiliated with Wabbajack, Nexus Mods or Bethesda. Wabbajack modlists and the mods
they reference belong to their respective authors.
