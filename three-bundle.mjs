// Vendor bundle entry. esbuild compiles this to vendor/three-bundle.js (IIFE),
// which exposes modern three + the addons app.js uses on window.THREE — same
// shape the old r147 UMD builds provided, so app.js stays a plain script and
// the portable single-file build keeps working. Rebuild: node build-vendor.js
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

// Area lights need their LTC lookup tables initialised once, up front.
RectAreaLightUniformsLib.init();

window.THREE = Object.assign({}, THREE, {
  OrbitControls, RoomEnvironment, RoundedBoxGeometry,
  EffectComposer, RenderPass, ShaderPass, GTAOPass, UnrealBloomPass, OutputPass,
  FXAAShader, RectAreaLightUniformsLib,
  // legacy alias: app.js sets texture colour spaces via this constant
  sRGBEncoding: THREE.SRGBColorSpace
});
