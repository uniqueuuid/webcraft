"use strict";

import HUD from "./hud.js";
import {CHUNK_SIZE_X} from "./blocks.js";
import rendererProvider from "./renders/rendererProvider.js";
import {Vox_Loader} from "./vox/loader.js";
import {Vox_Mesh} from "./vox/mesh.js";
import {Game} from "./game.js";
import {Vector} from "./helpers.js";

const {mat4} = glMatrix;

/**
* Renderer
*
* This class contains the code that takes care of visualising the
* elements in the specified world.
**/
const BACKEND               = 'auto';
export const ZOOM_FACTOR    = 0.25;
const FOV_CHANGE_SPEED      = 150;
const FOV_NORMAL            = 75;
const FOV_WIDE              = FOV_NORMAL * 1.15;
const FOV_ZOOM              = FOV_NORMAL * ZOOM_FACTOR;
const RENDER_DISTANCE       = 800;

let settings = {
    fogColor:               [118 / 255, 194 / 255, 255 / 255, 1],
    // fogColor:               [185 / 255, 210 / 255, 254 / 255, 1],
    fogUnderWaterColor:     [55 / 255, 100 / 255, 190 / 255, 1],
    fogAddColor:            [0, 0, 0, 0],
    fogUnderWaterAddColor:  [55 / 255, 100 / 255, 190 / 255, 0.75],
    fogDensity:             2.52 / 320, // 170, //  0.015 = 168, 0.03 = 84
    fogDensityUnderWater:   0.1
};

let currentRenderState = {
    // fogColor:           [185 / 255, 210 / 255, 254 / 255, 1],
    fogColor:           [118 / 255, 194 / 255, 255 / 255, 1],
    fogDensity:         0.02,
    underWater:         false
};

// Creates a new renderer with the specified canvas as target.
export class Renderer {

    constructor(renderSurfaceId) {
        this.canvas             = document.getElementById(renderSurfaceId);
        this.canvas.renderer    = this;
        this.testLightOn        = false;
        this.sunDir             = [0.9593, 1.0293, 0.6293]; // [0.7, 1.0, 0.85];
        this.renderBackend = rendererProvider.getRenderer(
            this.canvas,
            BACKEND, {
                antialias: false,
                depth: true,
                premultipliedAlpha: false
            });
    }

    async init(world, settings, resources) {
        return new Promise(res => {
            this._init(world, settings, resources, res);
        })
    }

    get gl() {
        return this.renderBackend.gl;
    }

    async genTerrain(image) {
        this.terrainTexSize = image.width;
        this.terrainBlockSize = image.width / 512 * 16;

        if (!this.useAnisotropy) {
            if (image instanceof  self.ImageBitmap) {
                return  image;
            }
            return await self.createImageBitmap(image, {premultiplyAlpha: 'none'});
        }

        const canvas2d = document.createElement('canvas');
        const context = canvas2d.getContext('2d');
        const w = image.width;
        canvas2d.width = w * 2;
        canvas2d.height = w * 2;

        let offset = 0;

        context.drawImage(image, 0, 0);

        for (let dd = 2; dd <= 16; dd *= 2) {
            const nextOffset = offset + w * 2 / dd;
            context.drawImage(canvas2d, offset, 0, w * 2 / dd, w, nextOffset, 0, w / dd, w);
            offset = nextOffset;
        }
        offset = 0;
        for (let dd = 2; dd <= 16; dd *= 2) {
            const nextOffset = offset + w * 2 / dd;
            context.drawImage(canvas2d, 0, offset, w * 2, w * 2 / dd, 0, nextOffset, w * 2, w / dd);
            offset = nextOffset;
        }
        // canvas2d.width = 0;
        // canvas2d.height = 0;
        //return await self.createImageBitmap(canvas2d);
        return canvas2d;
    }

    async genColorTexture(clr) {
        const canvas2d = document.createElement('canvas');
        canvas2d.width = canvas2d.height = 16;

        const context = canvas2d.getContext('2d');
        context.fillStyle = 'white';
        context.fillRect(0, 0, 16, 16);

        return canvas2d;
    }

    // todo
    //  GO TO PROMISE
    async _init(world, settings, resources, callback) {
        this.resources          = resources;
        this.skyBox             = null;
        this.videoCardInfoCache = null;
        this.options         = {FOV_NORMAL, FOV_WIDE, FOV_ZOOM, ZOOM_FACTOR, FOV_CHANGE_SPEED, RENDER_DISTANCE};

        this.setWorld(world);

        const {renderBackend} = this;

        await renderBackend.init();

        const shader = this.shader = renderBackend.createShader({ code: resources.codeMain});

        // Create projection and view matrices
        this.projMatrix = this.shader.projMatrix;
        this.viewMatrix = this.shader.viewMatrix;
        this.modelMatrix = this.shader.modelMatrix;
        this.brightness = 1;

        // Initialise WebGL
        // const gl = this.renderBackend.gl;

        this.viewportWidth        = this.canvas.width;
        this.viewportHeight       = this.canvas.height;
        renderBackend.resize(this.viewportWidth, this.viewportHeight);

        this.useAnisotropy = settings.mipmap;
        this.terrainTexSize = 1;
        this.terrainBlockSize = 1;

        this.terrainTexture = renderBackend.createTexture({
            source: await this.genTerrain(resources.terrain.image),
            minFilter: 'nearest',
            magFilter: 'nearest',
            anisotropy: this.useAnisotropy ? 4.0 : 0.0,
        });

        this.materials = {
            regular: renderBackend.createMaterial({ cullFace: true, opaque: true, shader}),
            doubleface: renderBackend.createMaterial({ cullFace: false, opaque: true, shader}),
            transparent: renderBackend.createMaterial({ cullFace: false, opaque: false, shader}),
            label: renderBackend.createMaterial({ cullFace: false, ignoreDepth: true, shader}),
        }

        this.texWhite = renderBackend.createTexture({ source: await this.genColorTexture('white') });
        this.texBlack = renderBackend.createTexture({ source: await this.genColorTexture('black') });

        this.setPerspective(FOV_NORMAL, 0.01, RENDER_DISTANCE);

        shader.texture = this.terrainTexture;

        if (renderBackend) {
            // SkyBox
            this.initSky();
        }

        // HUD
        // Build main HUD
        Game.hud = new HUD(0, 0);
        this.HUD = {
            tick: 0,
            bufRect: null,
            draw: function() {
                Game.hud.draw();
            }
        }

        callback();
    }

    initSky() {
        const { resources } = this;

        return this.skyBox = this.renderBackend.createCubeMap({
            code: resources.codeSky,
            sides: [
                resources.sky.posx,
                resources.sky.negx,
                resources.sky.posy,
                resources.sky.negy,
                resources.sky.posz,
                resources.sky.negz
            ]
        });
    }

    // Makes the renderer start tracking a new world and set up the chunk structure.
    // world - The world object to operate on.
    // chunkSize - X, Y and Z dimensions of each chunk, doesn't have to fit exactly inside the world.
    setWorld(world) {
        this.world = world;
        world.renderer = this;
    }

    // setBrightness...
    setBrightness(value) {
        this.brightness = value;
        let mult = Math.min(1, value * 2)
        currentRenderState.fogColor = [
            settings.fogColor[0] * (value * mult),
            settings.fogColor[1] * (value * mult),
            settings.fogColor[2] * (value * mult),
            settings.fogColor[3]
        ]
    }

    // toggleNight...
    toggleNight() {
        if(this.brightness == 1) {
            this.setBrightness(.15);
        } else {
            this.setBrightness(1);
        }
    }

    // Render one frame of the world to the canvas.
    draw(delta) {
        const { gl, shader, renderBackend } = this;
        // console.log(Game.world.renderer.camPos[2]);
        //if(Game.world.localPlayer.pos.z + 1.7 < 63.8) {
        //    currentRenderState.fogDensity   = settings.fogDensityUnderWater;
        //    currentRenderState.fogColor     = settings.fogUnderWaterColor;
        //    currentRenderState.fogAddColor  = settings.fogUnderWaterAddColor;
        //} else {
        currentRenderState.fogDensity   = settings.fogDensity;
        // currentRenderState.fogColor     = settings.fogColor;
        currentRenderState.fogAddColor  = settings.fogAddColor;
        //}
        this.updateViewport();
        renderBackend.beginFrame(currentRenderState.fogColor);
        //
        shader.blockSize = this.terrainBlockSize / this.terrainTexSize;
        shader.pixelSize = 1.0 / this.terrainTexSize;
        shader.fogColor = currentRenderState.fogColor;
        shader.chunkBlockDist = this.world.chunkManager.CHUNK_RENDER_DIST * CHUNK_SIZE_X - CHUNK_SIZE_X * 2;
        shader.brightness = this.brightness;
        shader.fogDensity = currentRenderState.fogDensity;
        shader.fogAddColor = currentRenderState.fogAddColor;
        shader.texture = this.terrainTexture;
        shader.mipmap = this.terrainTexture.anisotropy;
        // shader.camPos.set([Game.shift.x, Game.shift.z, 0]);
        const {
            width, height
        } = renderBackend.size;
        shader.resolution = [width, height];
        shader.shift = [Game.shift.x, Game.shift.z, Game.shift.y];
        shader.testLightOn = this.testLightOn;
        shader.sunDir = this.sunDir;
        if (renderBackend.gl) {
            mat4.perspectiveNO(this.projMatrix, this.fov * Math.PI/180.0, width / height, this.min, this.max);
        } else {
            mat4.perspectiveZO(this.projMatrix, this.fov * Math.PI/180.0, width / height, this.min, this.max);
        }
        // 1. Draw skybox
        if(this.skyBox) {
            this.skyBox.draw(this.viewMatrix, this.projMatrix, width, height);
        }
        shader.bind();
        shader.update();
        // 2. Draw chunks
        this.terrainTexture.bind(4);
        this.world.chunkManager.draw(this);
        
        /*
        if(!this.vl && Game.shift.x != 0) {
            this.vl = new Vox_Loader('/data/monu10.vox', (chunks) => {
                this.voxel_mesh = new Vox_Mesh(chunks[0], new Vector(3120, 65, 2863), Game.shift, this.materials['regular']);
            });
        }
        if(this.voxel_mesh) {
            this.voxel_mesh.draw(this.renderBackend);
        }
        */
        
        this.world.draw(this, delta);
        // 3. Draw players and rain
        this.drawPlayers(delta);
        // 4. Draw HUD
        if(this.HUD) {
            this.HUD.draw();
        }
        renderBackend.endFrame();
    }

    // drawPlayers
    drawPlayers(delta) {
        const {renderBackend, shader} = this;
        shader.bind();
        for(let id of Object.keys(this.world.players)) {
            let player = this.world.players[id];
            if(player.id != this.world.server.id) {
                player.draw(this, this.camPos, delta);
            }
        }
    }

    /**
    * Check if the viewport is still the same size and update
    * the render configuration if required.
    */
    updateViewport() {
        let canvas = this.canvas;
        if (canvas.clientWidth !== this.viewportWidth ||
            canvas.clientHeight !== this.viewportHeight
        ) {
            // resize call _configure automatically but ONLY if dimension changed
            // _configure very slow!
            this.renderBackend.resize(
                window.innerWidth * self.devicePixelRatio | 0,
                window.innerHeight * self.devicePixelRatio | 0);

            this.viewportWidth = window.innerWidth | 0;
            this.viewportHeight = window.innerHeight | 0;

            // Update perspective projection based on new w/h ratio
            this.setPerspective(this.fov, this.min, this.max);
        }
    }

    // refresh...
    refresh() {
        this.world.chunkManager.refresh();
    }

    // Sets the properties of the perspective projection.
    setPerspective(fov, min, max) {
        this.fov = fov;
        this.min = min;
        this.max = max;
    }

    // Moves the camera to the specified orientation.
    //
    // pos - Position in world coordinates.
    // ang - Pitch, yaw and roll.
    setCamera(pos, ang) {
        pos = [...pos];
        let pitch   = ang[0]; // X
        let roll    = ang[1]; // Z
        let yaw     = ang[2]; // Y
        let v_add = Math.cos(this.world.localPlayer.walking_frame * (15 * (this.world.localPlayer.running ? 1.5 : 1))) * .045;
        let h_add = Math.cos(this.world.localPlayer.walking_frame * (7.5 * (this.world.localPlayer.running ? 1.5 : 1))) * .045;
        if(v_add < -.01) v_add = -.01;
        pos[0] += Math.cos(yaw) * h_add;
        pos[2] += Math.sin(yaw) * h_add;
        roll += h_add / 15;
        this.camPos = pos;
        mat4.identity(this.viewMatrix);
        mat4.rotate(this.viewMatrix, this.viewMatrix, -pitch - Math.PI / 2, [1, 0, 0]);
        mat4.rotate(this.viewMatrix, this.viewMatrix, roll, [0, 1, 0]);
        mat4.rotate(this.viewMatrix, this.viewMatrix, yaw, [0, 0, 1]);
        mat4.translate(this.viewMatrix, this.viewMatrix, [
            -pos[0] + Game.shift.x,
            -pos[2] + Game.shift.z,
            -pos[1] + v_add
        ]);
    }

    // getVideoCardInfo...
    getVideoCardInfo() {
        if(this.videoCardInfoCache) {
            return this.videoCardInfoCache;
        }
        let gl = this.renderBackend.gl;
        if (!gl) {
            return {
                error: 'no webgl',
            };
        }
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        let resp = null;
        if(debugInfo) {
            resp = {
                vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
                renderer:  gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
            };
        }
        resp = {
            error: 'no WEBGL_debug_renderer_info',
        };
        this.videoCardInfoCache = resp;
        return resp;
    }

}
