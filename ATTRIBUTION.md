# Attribution

Everything in AFTER is either generated at runtime or public domain. Nothing
here requires a licence fee, an account, or an attribution notice in-game —
but the people who made the free things deserve to be named.

## Character models — `public/assets/models/`

| File | Source model | Pack | Author | Licence |
| --- | --- | --- | --- | --- |
| `survivor.glb` | `Characters_Matt.gltf` | Zombie Apocalypse Kit (March 2024) | [Quaternius](https://quaternius.com/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `zombie_basic.glb` | `Zombie_Basic.gltf` | Zombie Apocalypse Kit (March 2024) | [Quaternius](https://quaternius.com/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `zombie_chubby.glb` | `Zombie_Chubby.gltf` | Zombie Apocalypse Kit (March 2024) | [Quaternius](https://quaternius.com/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `zombie_arm.glb` | `Zombie_Arm.gltf` | Zombie Apocalypse Kit (March 2024) | [Quaternius](https://quaternius.com/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

Pack page: <https://quaternius.com/packs/zombieapocalypsekit.html>
Download: the "Download" button on that page → Google Drive folder
`1mWP6sCHun7OUMHQeDNZLrXTteXlzWg_t`, `Characters/glTF/`.
Upstream licence file as shipped: `public/assets/models/Quaternius-License.txt`
(its header names a different Quaternius pack — a copy-paste slip in the
original archive; the pack page itself states CC0 1.0 for this kit).

CC0 1.0 is a public-domain dedication: no attribution is required. This table
exists because it should.

### What was changed

The upstream files are `.gltf` with every buffer and texture inlined as
base64, carrying the full animation set and all ten hand-held weapons. They
were pruned and re-packed into binary `.glb` by `tools/gltf2glb.py`:

* unused clips dropped (`Wave`, `Yes`, `No`, `Run_Slash`, `Run_Stab`, and the
  jump set on zombies),
* unused weapon meshes dropped from the survivor (`Guitar`, `Rifle`,
  `Shotgun`, `SMG`, `Spear`, `WoodenBat_Saw`),
* orphaned accessors / bufferViews / textures garbage-collected,
* base64 payloads repacked into a single binary chunk.

Total on disk went from 7.5 MB to 2.7 MB. Geometry, rig, UVs and the surviving
animation curves are bit-for-bit the originals; nothing was re-authored.

Material colour variants (eight per model) are generated at load time by
recolouring the palette atlas on a canvas — see `src/entities/CharacterAssets.js`.
The source atlas is untouched on disk.

## Everything else

Geometry (`src/world/Builders.js`), textures (`src/world/Textures.js`), audio
(`src/systems/AudioSys.js`), the procedural fallback humanoid
(`src/entities/CharacterMesh.js`) and all animation logic are original work
generated at runtime, with no external assets.

## Libraries

| Library | Licence |
| --- | --- |
| [three.js](https://threejs.org/) | MIT |
| [Vite](https://vitejs.dev/) | MIT |
