/** Read our baked, uncompressed GLB once; each ship shares its GPU resources. */
(function (root) {
  'use strict';
  const THREE = root.THREE;
  let template = null;

  function readAsset() {
    const bytes = Uint8Array.from(atob(root.VinlandKnarrData), (character) =>
      character.charCodeAt(0),
    );
    const header = new DataView(bytes.buffer);
    if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2)
      throw Error('The knarr asset must be a GLB 2.0 file.');
    const jsonLength = header.getUint32(12, true);
    const document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
    const binaryStart = 20 + jsonLength + 8;

    // Intentionally supports only this baked asset's subset: float VEC3
    // attributes, uint32 indices and triangle meshes without node transforms.
    // This is not a general glTF importer. The editable GLB remains standard.
    function attribute(index) {
      const accessor = document.accessors[index],
        view = document.bufferViews[accessor.bufferView];
      const components = accessor.type === 'VEC3' ? 3 : 1;
      const Type = accessor.componentType === 5126 ? Float32Array : Uint32Array;
      return new THREE.BufferAttribute(
        new Type(bytes.buffer, binaryStart + view.byteOffset, accessor.count * components),
        components,
      );
    }
    const materials = document.materials.map((entry) => {
      const pbr = entry.pbrMetallicRoughness;
      return new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: pbr.roughnessFactor,
        metalness: pbr.metallicFactor,
        side: entry.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      });
    });
    const group = new THREE.Group();
    group.name = 'Baked knarr structure';
    for (const entry of document.meshes) {
      const primitive = entry.primitives[0],
        geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', attribute(primitive.attributes.POSITION));
      geometry.setAttribute('normal', attribute(primitive.attributes.NORMAL));
      geometry.setAttribute('color', attribute(primitive.attributes.COLOR_0));
      geometry.setIndex(attribute(primitive.indices));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, materials[primitive.material]);
      mesh.name = entry.name;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }

  function create() {
    template ||= readAsset();
    const group = new THREE.Group();
    group.add(template.clone());
    // Preserve the existing passenger, boarding and cargo coordinates. Each
    // ship needs its own obstacle list because livestock fittings differ.
    group.userData.boatGeometry = {
      length: 17.5,
      width: 5.2,
      deckHeight: 1.16,
      deckEnd: (17.5 * 6.4) / 14,
      obstacles: [{ x: 0, z: 0, radius: 0.18 }],
    };
    return group;
  }
  root.VinlandKnarr = { create };
})(window);
