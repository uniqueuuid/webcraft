import {impl as alea} from "../../vendors/alea.js";

// FastRandom...
export class FastRandom {
    [key: string]: any;
    int32s: any[];
    doubles: any[];
    index: number;
    cnt: any;

    /**
     * @param seed : string
     * @param cnt : int
     */
    constructor(seed : string, cnt : int) {
        const a = new alea(seed);
        this.int32s = new Array(cnt);
        this.doubles = new Array(cnt);
        this.index = 0;
        this.cnt = cnt;
        for(let i = 0; i < cnt; i++) {
            this.int32s[i] = a.int32();
            this.doubles[i] = a.double();
        }
    }

    double(offset : number) : float {
        offset = Math.abs(offset) % this.cnt;
        return this.doubles[offset];
    }

    int32(offset : number) : int {
        offset = Math.abs(offset) % this.cnt;
        return this.int32s[offset];
    }

}

/**
 * @param {string} seed
 * @param {int} len
 * @returns
 */
export function createFastRandom(seed : string, len : int = 512) {
    const random_alea = new alea(seed);
    // fast random
    const randoms = new Array(len); // new Float32Array(len)
    for(let i = 0; i < len; i++) {
        randoms[i] = random_alea.double();
    }
    let random_index = 0;
    // return random_alea.double
    return () => randoms[random_index++ % len];
}
