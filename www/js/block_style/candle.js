import {DIRECTION, QUAD_FLAGS, MULTIPLY, Vector} from '../helpers.js';
import {BLOCK} from "../blocks.js";
import {AABB} from '../core/AABB.js';
import { default as default_style, TX_SIZE } from './default.js';
import glMatrix from '../../vendors/gl-matrix-3.3.min.js';

const WIDTH =  4 / TX_SIZE;
const HEIGHT = 6 / TX_SIZE;

const {mat4} = glMatrix;

const lm = MULTIPLY.COLOR.WHITE.clone();

// Свечи
export default class style {

    // getRegInfo
    static getRegInfo() {
        return {
            styles: ['candle'],
            func: this.func,
            aabb: this.computeAABB
        };
    }

    // computeAABB
    static computeAABB(block, for_physic) {
        let y = 0; // 1 - .85;
        let aabb = new AABB();
        aabb.set(
            0 + .5 - WIDTH / 2,
            y,
            0 + .5 - WIDTH / 2,
            0 + .5 + WIDTH / 2,
            y + HEIGHT,
            0 + .5 + WIDTH / 2,
        );

        //
        if(!for_physic) {
            aabb.pad(1/500);
        }

        return [aabb];
    }

    // Build function
    static func(block, vertices, chunk, x, y, z, neighbours, biome, dirt_color, unknown, matrix, pivot, force_tex) {

        if(!block || typeof block == 'undefined' || block.id == BLOCK.AIR.id) {
            return;
        }

        const c_up_top          = BLOCK.calcMaterialTexture(block.material, DIRECTION.UP, null, null, block);
        const count             = Math.min(block.extra_data?.candles || 1, 4);
        const flag              = QUAD_FLAGS.NO_AO | QUAD_FLAGS.NORMAL_UP;

        const candles = [
            [{mx: 0, mz: 0, height: 5}],
            [{mx: 0, mz: -1.5, height: 5}, {mx: 0, mz: 1.5, height: 3}],
            [{mx: -1.5, mz: -1.5, height: 5}, {mx: -1.5, mz: 1.5, height: 3},{mx: 1.5, mz: 0, height: 2}],
            [{mx: -1.5, mz: -1.5, height: 5}, {mx: -1.5, mz: 1.5, height: 3}, {mx: 1.5, mz: -1.5, height: 2}, {mx: 1.5, mz: 1.5, height: 4}]
        ][count - 1];

        // Geometries
        const parts = [];
        const planes = [];

        for(let candle of candles) {

            const {height, mx, mz} = candle;
            const pos = new Vector(x, y - (1 - height / TX_SIZE) / 2, z);

            planes.push(...[
                {
                    pos: pos.add(new Vector(mx / TX_SIZE, (height / 2 + .5) / TX_SIZE, mz / TX_SIZE)),
                    size: {x: 0, y: 1, z: 1},
                    uv: [0.5, 5.5],
                    rot: [0, Math.PI / 4, 0]
                },
                {
                    pos: pos.add(new Vector(mx / TX_SIZE, (height / 2 + .5) / TX_SIZE, mz / TX_SIZE)),
                    size: {x: 0, y: 1, z: 1},
                    uv: [0.5, 5.5],
                    rot: [0, Math.PI / 4 + Math.PI / 2, 0]
                }
            ]);

            // part
            parts.push({
                pos,
                "size": {"x": 2, "y": height, "z": 2},
                "translate": {"x": mx, "y": 0, "z": mz},
                "faces": {
                    "down":  {"uv": [1, 7], "flag": flag, "texture": c_up_top},
                    "up":    {"uv": [1, 7], "flag": flag, "texture": c_up_top},
                    "north": {"uv": [1, 11], "flag": flag, "texture": c_up_top},
                    "south": {"uv": [1, 11], "flag": flag, "texture": c_up_top},
                    "west":  {"uv": [1, 11], "flag": flag, "texture": c_up_top},
                    "east":  {"uv": [1, 11], "flag": flag, "texture": c_up_top}
                }
            });

        }

        for(let plane of planes) {
            default_style.pushPlane(vertices, {
                ...plane,
                lm:         lm,
                matrix:     matrix,
                pos:        plane.pos,
                flag:       flag,
                texture:    [...c_up_top]
            });
        }

        for(let part of parts) {
            default_style.pushAABB(vertices, {
                ...part,
                lm:         lm,
                pos:        part.pos,
                matrix:     matrix
            });
        }

        return null;

    }

}