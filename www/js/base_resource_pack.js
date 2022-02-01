import {BLOCK} from "./blocks.js";
import {Helpers} from './helpers.js';
import {Resources} from'./resources.js';
import {TerrainTextureUniforms} from "./renders/common.js";

let tmpCanvas;

export class BaseResourcePack {

    constructor(location, id) {
        this.id = id;
        this.dir = location;
        this.textures = new Map();
        this.materials = new Map();

        this.manager = null;
        this.shader = null;
    }

    async init(manager) {
        this.manager = manager;

        let dir = this.dir;

        return Promise.all([
            Helpers.fetchJSON(dir + '/conf.json'),
            Helpers.fetchJSON(dir + '/blocks.json')
        ]).then(async ([conf, json]) => {
            this.conf = conf;
            for(let b of json) {
                await BLOCK.add(this, b);
            }
        })
    }

    async initShaders(renderBackend, shared = false) {
        if (this.shader) {
            this.shader.shared = shared;
            return this.shader;
        }

        let shader_options = null;

        if (!this.conf.shader || this.conf.shader.extends) {
            const pack = this.manager.list.get(this.conf.shader?.extends || 'base');

            if (pack) {
                return this.shader = await pack.initShaders(renderBackend, true);
            }
        }

        if('gl' in renderBackend) {
            shader_options = this.conf.shader.webgl;
            shader_options = {
                vertex : this.dir + shader_options.vertex,
                fragment : this.dir + shader_options.fragment
            }
        } else {
            shader_options = this.dir + this.conf.shader.webgpu;
        }
    
        this.shader = await renderBackend.createResourcePackShader(shader_options);
        this.shader.resource_pack_id = this.id;
        this.shader.shared = shared;

        return this.shader;
    }

    async _loadTexture (url, settings, renderBackend) {
        const image = await Resources.loadImage(url, true);

        const texture = renderBackend.createTexture({
            source: await this.genMipMapTexture(image, settings),
            style: this.genTextureStyle(image, settings),
            minFilter: 'nearest',
            magFilter: 'nearest',
        });

        return {
            image, texture
        }
    }

    async _processTexture (textureInfo, renderBackend, settings) {
        const {image, texture} = await this._loadTexture(
            this.dir + textureInfo.image,
            settings,
            renderBackend
        );

        textureInfo.texture = texture;
        textureInfo.width   = image.width;
        textureInfo.height  = image.height;
        textureInfo.texture_n = null;

        // Get image bytes
        const canvas        = tmpCanvas;
        const ctx           = canvas.getContext('2d');
        
        canvas.width        = image.width;
        canvas.height       = image.height;

        ctx.drawImage(
            image, 0, 0,
            image.width,
            image.height, 0, 0, 
            image.width, image.height
        );
        
        textureInfo.imageData = ctx.getImageData(0, 0, image.width, image.height);

        canvas.width = canvas.height = 0;

        if ('image_n' in textureInfo) {
            const { texture } = await this._loadTexture(
                this.dir + textureInfo.image_n,
                settings,
                renderBackend
            );

            textureInfo.texture_n = texture;
        }
    }

    async initTextures(renderBackend, settings) {
        if (!this.conf.textures) {
            return;
        }
        
        const tasks = [];

        tmpCanvas = tmpCanvas || document.createElement('canvas');

        for(let [k, v] of Object.entries(this.conf.textures)) {
            tasks.push(this._processTexture(v, renderBackend, settings));

            this.textures.set(k, v);
        }

        return Promise.all(tasks)
    }

    genTextureStyle(image, settings) {
        let terrainTexSize          = image.width;
        let terrainBlockSize        = image.width / 512 * 16;
        const style = new TerrainTextureUniforms();
        style.blockSize = terrainBlockSize / terrainTexSize;
        style.pixelSize = 1.0 / terrainTexSize;
        style.mipmap = settings.mipmap ? 4.0 : 0.0;
        return style;
    }

    //
    getMaterial(key) {
        let texMat = this.materials.get(key);
        if(texMat) {
            return texMat;
        }
        let key_arr = key.split('/');
        let group = key_arr[1];
        let texture_id = key_arr[2];
        let mat = this.shader.materials[group];
        texMat = mat.getSubMat(this.getTexture(texture_id).texture);
        this.materials.set(key, texMat);
        return texMat;
    }

    //
    async genMipMapTexture(image, settings) {
        if (!settings.mipmap) {
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
        // return await self.createImageBitmap(canvas2d);
        /*
            var link = document.createElement('a');
            link.download = 'filename.png';
            link.href = canvas2d.toDataURL()
            link.click();
        */
        return canvas2d;
    }

    getTexture(id) {
        return this.textures.get(id);
    }

    // pushVertices
    pushVertices(vertices, block, world, x, y, z, neighbours, biome, draw_style) {
        const style = draw_style ? draw_style : block.material.style;
        const module = BLOCK.styles.get(style);
        if(!module) {
            throw 'Invalid vertices style `' + style + '`';
        }
        return module.func(block, vertices, world, x, y, z, neighbours, biome, true);
    }
}
