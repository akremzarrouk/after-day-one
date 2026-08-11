"""
gltf2glb.py — prune + pack a data-URI glTF 2.0 file into a binary .glb.

Quaternius ships .gltf with every buffer and image inlined as base64, and with
animation/mesh sets far larger than one game needs. This does three things:

  1. drops animations and static mesh nodes we never play/show,
  2. garbage-collects every accessor / bufferView / texture / image / material
     that nothing references any more,
  3. rewrites the survivors into a single BIN chunk and emits a .glb.

Pure stdlib so it runs anywhere; nothing here ships with the game.
"""
import base64
import json
import struct
import sys


# ─────────────────────────────────────────────────────────────── helpers ──

def decode_uri(uri):
    assert uri.startswith('data:'), 'expected an inlined data: URI, got ' + uri[:32]
    return base64.b64decode(uri.split(',', 1)[1])


def buffer_bytes(g):
    """Flatten all buffers into one bytes object + per-buffer base offsets."""
    blobs, offsets, cur = [], [], 0
    for b in g['buffers']:
        raw = decode_uri(b['uri'])
        blobs.append(raw)
        offsets.append(cur)
        cur += len(raw)
    return b''.join(blobs), offsets


# ───────────────────────────────────────────────────────────────── prune ──

def drop_animations(g, keep):
    before = [a['name'] for a in g.get('animations', [])]
    g['animations'] = [a for a in g.get('animations', []) if a['name'] in keep]
    kept = [a['name'] for a in g['animations']]
    missing = [k for k in keep if k not in before]
    if missing:
        print('    !! requested clips not in file:', missing)
    return kept


def drop_nodes(g, drop_names):
    """Remove leaf nodes by name, then re-index everything that points at nodes."""
    dead = {i for i, n in enumerate(g['nodes']) if n.get('name') in drop_names}
    if not dead:
        return []
    for i in dead:
        assert not g['nodes'][i].get('children'), 'refusing to drop a node with children'

    remap, out = {}, []
    for i, n in enumerate(g['nodes']):
        if i in dead:
            continue
        remap[i] = len(out)
        out.append(n)
    g['nodes'] = out

    for n in g['nodes']:
        if 'children' in n:
            n['children'] = [remap[c] for c in n['children'] if c in remap]
            if not n['children']:
                del n['children']
    for s in g.get('scenes', []):
        s['nodes'] = [remap[i] for i in s['nodes'] if i in remap]
    for sk in g.get('skins', []):
        sk['joints'] = [remap[i] for i in sk['joints']]
        if 'skeleton' in sk:
            sk['skeleton'] = remap[sk['skeleton']]
    for a in g.get('animations', []):
        chans = []
        for ch in a['channels']:
            t = ch['target'].get('node')
            if t is None or t not in remap:
                continue
            ch['target']['node'] = remap[t]
            chans.append(ch)
        a['channels'] = chans
    return sorted(drop_names)


# ────────────────────────────────────────────────────────────────── gc ──

def gc(g):
    """Sweep unreachable meshes / materials / textures / images / accessors."""
    used_mesh = {n['mesh'] for n in g['nodes'] if 'mesh' in n}
    keep_mesh = sorted(used_mesh)
    mesh_map = {old: i for i, old in enumerate(keep_mesh)}
    g['meshes'] = [g['meshes'][i] for i in keep_mesh]
    for n in g['nodes']:
        if 'mesh' in n:
            n['mesh'] = mesh_map[n['mesh']]

    used_mat = set()
    for m in g['meshes']:
        for p in m['primitives']:
            if 'material' in p:
                used_mat.add(p['material'])
    keep_mat = sorted(used_mat)
    mat_map = {old: i for i, old in enumerate(keep_mat)}
    g['materials'] = [g['materials'][i] for i in keep_mat]
    for m in g['meshes']:
        for p in m['primitives']:
            if 'material' in p:
                p['material'] = mat_map[p['material']]

    TEX_SLOTS = ('baseColorTexture', 'metallicRoughnessTexture',
                 'normalTexture', 'occlusionTexture', 'emissiveTexture')

    def tex_refs(mat):
        for k in TEX_SLOTS:
            if k in mat:
                yield mat, k
        pbr = mat.get('pbrMetallicRoughness', {})
        for k in TEX_SLOTS:
            if k in pbr:
                yield pbr, k

    used_tex = {holder[k]['index'] for mat in g.get('materials', []) for holder, k in tex_refs(mat)}
    keep_tex = sorted(used_tex)
    tex_map = {old: i for i, old in enumerate(keep_tex)}
    g['textures'] = [g['textures'][i] for i in keep_tex]
    for mat in g.get('materials', []):
        for holder, k in tex_refs(mat):
            holder[k]['index'] = tex_map[holder[k]['index']]

    used_img = {t['source'] for t in g.get('textures', []) if 'source' in t}
    keep_img = sorted(used_img)
    img_map = {old: i for i, old in enumerate(keep_img)}
    g['images'] = [g['images'][i] for i in keep_img]
    for t in g.get('textures', []):
        if 'source' in t:
            t['source'] = img_map[t['source']]

    used_acc = set()
    for m in g['meshes']:
        for p in m['primitives']:
            used_acc.update(p['attributes'].values())
            if 'indices' in p:
                used_acc.add(p['indices'])
            for tgt in p.get('targets', []):
                used_acc.update(tgt.values())
    for a in g.get('animations', []):
        for s in a['samplers']:
            used_acc.add(s['input'])
            used_acc.add(s['output'])
    for sk in g.get('skins', []):
        if 'inverseBindMatrices' in sk:
            used_acc.add(sk['inverseBindMatrices'])

    keep_acc = sorted(used_acc)
    acc_map = {old: i for i, old in enumerate(keep_acc)}
    g['accessors'] = [g['accessors'][i] for i in keep_acc]
    for m in g['meshes']:
        for p in m['primitives']:
            p['attributes'] = {k: acc_map[v] for k, v in p['attributes'].items()}
            if 'indices' in p:
                p['indices'] = acc_map[p['indices']]
            for tgt in p.get('targets', []):
                for k in list(tgt):
                    tgt[k] = acc_map[tgt[k]]
    for a in g.get('animations', []):
        for s in a['samplers']:
            s['input'] = acc_map[s['input']]
            s['output'] = acc_map[s['output']]
    for sk in g.get('skins', []):
        if 'inverseBindMatrices' in sk:
            sk['inverseBindMatrices'] = acc_map[sk['inverseBindMatrices']]


# ──────────────────────────────────────────────────────────────── repack ──

def repack(g, blob, base_offsets):
    """Rewrite every surviving bufferView into one fresh, 4-byte-aligned buffer."""
    out = bytearray()
    views = []

    def emit(data, stride=None, target=None):
        while len(out) % 4:
            out.append(0)
        off = len(out)
        out.extend(data)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if stride is not None:
            v['byteStride'] = stride
        if target is not None:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    for acc in g['accessors']:
        if 'bufferView' not in acc:
            continue
        old = g['bufferViews'][acc['bufferView']]
        start = base_offsets[old['buffer']] + old.get('byteOffset', 0)
        data = blob[start:start + old['byteLength']]
        acc['bufferView'] = emit(data, old.get('byteStride'), old.get('target'))
        acc.pop('byteOffset', None)

    for img in g.get('images', []):
        if 'uri' in img:
            data = decode_uri(img['uri'])
            mime = img['uri'].split(';')[0][5:]
            del img['uri']
        else:
            old = g['bufferViews'][img['bufferView']]
            start = base_offsets[old['buffer']] + old.get('byteOffset', 0)
            data = blob[start:start + old['byteLength']]
            mime = img.get('mimeType', 'image/png')
        img['mimeType'] = mime
        img['bufferView'] = emit(data)

    g['bufferViews'] = views
    g['buffers'] = [{'byteLength': len(out)}]
    return bytes(out)


def write_glb(path, g, bin_chunk):
    js = json.dumps(g, separators=(',', ':')).encode('utf8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    bin_chunk += b'\0' * ((4 - len(bin_chunk) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_chunk)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(bin_chunk), 0x004E4942))
        f.write(bin_chunk)
    return total


def convert(src, dst, keep_anims=None, drop_meshes=()):
    g = json.load(open(src, encoding='utf8'))
    blob, offsets = buffer_bytes(g)
    print('  %s' % src)
    if keep_anims is not None:
        kept = drop_animations(g, keep_anims)
        print('    clips kept (%d): %s' % (len(kept), ', '.join(kept)))
    if drop_meshes:
        print('    nodes dropped:', ', '.join(drop_nodes(g, set(drop_meshes))))
    gc(g)
    bin_chunk = repack(g, blob, offsets)
    size = write_glb(dst, g, bin_chunk)
    print('    -> %s  %.2f MB (was %.2f MB)' % (dst, size / 1e6, len(open(src, 'rb').read()) / 1e6))


PLAYER_CLIPS = ['Idle', 'Idle_Gun', 'Walk', 'Walk_Gun', 'Run', 'Run_Gun',
                'Slash', 'Stab', 'Punch', 'Death', 'HitReact', 'Duck',
                'Jump', 'Jump_Idle', 'Jump_Land']
PLAYER_DROP = ['Guitar', 'Rifle', 'Shotgun', 'SMG', 'Spear', 'WoodenBat_Saw']

ZOMBIE_CLIPS = ['Idle', 'Idle_Attack', 'Walk', 'Run', 'Run_Arms', 'Run_Attack',
                'Punch', 'Death', 'HitReact', 'Crawl']

if __name__ == '__main__':
    src_dir, out_dir = sys.argv[1], sys.argv[2]
    convert(src_dir + '/Characters_Matt.gltf', out_dir + '/survivor.glb', PLAYER_CLIPS, PLAYER_DROP)
    for name, out in (('Zombie_Basic', 'zombie_basic'),
                      ('Zombie_Chubby', 'zombie_chubby'),
                      ('Zombie_Arm', 'zombie_arm')):
        convert('%s/%s.gltf' % (src_dir, name), '%s/%s.glb' % (out_dir, out), ZOMBIE_CLIPS)
