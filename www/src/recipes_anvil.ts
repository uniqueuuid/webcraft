import { BLOCK } from "./blocks.js";
import { ItemHelpers } from "./block_helpers.js";
import { ObjectHelpers } from "./helpers.js";
import { Enchantments } from "./enchantments.js"
import type { InventoryComparator } from "./inventory_comparator.js";

const REPAIR_PER_INGREDIENT = 0.25;
const REPAIR_PER_COMBINE_BONUS = 0.12;
// First, the we try to find the exact match by th 1st block name
const REPAIR_BY_NAMES = {
    'SHIELD':           { suffixes: ['_PLANKS'] },
    // These are not present in the game yet
    'TURTLE_HELMET':    { names: ['SCUTE'] },
    'ELYTRA':           { names: ['PHANTOM_MEMBRANE'] }
};
// If there is no exact match, we check the 1st block suffix and its material
const REPAIR_SUFFIXES = ['_SWORD', '_PICKAXE', '_AXE', '_SHOVEL', '_HOE',
    '_CAP', '_TUNIC', '_PANTS', '_BOOTS', '_HELMET', '_CHESTPLATE', '_LEGGINGS',
];
const REPAIR_BY_MATERIALS = {
    'wood':     { suffixes: ['_PLANKS'] },
    'leather':  { names: ['LEATHER'] },
    'stone':    { names: ['COBBLESTONE',
        // These are not in the game, but can be used in Minecraft
        'COBBLED_DEEPSLATE', 'BLACKSTONE'] }, 
    'iron':     { names: ['IRON_INGOT'] },
    'gold':     { names: ['GOLD_INGOT'] },
    'diamond':  { names: ['DIAMOND'] },
    'netherite':{ names: ['NETHERITE_INGOT'] }
};

export class AnvilRecipeManager {
    [key: string]: any;

    constructor() {
        this.recipes = new Map();

        this.addRecipe('rename',
            function(first_item, second_item, label, outCount) {
                if (first_item == null || second_item != null || label === false) {
                    return null;
                }
                if (label !== null) {
                    label = ItemHelpers.validateAndPreprocessLabel(label);
                }
                // We must not compare label with ItemHelpers.getLabel(first_item) here, because it depends
                // on the user's locale. The result should be the same on the server.

                outCount[0] = first_item.count;

                const result = ObjectHelpers.deepClone(first_item);
                ItemHelpers.setLabel(result, label);
                return result;
            }
        );

        this.addRecipe('repair', // repair by ingredients; repair by combining is 'combine'
            function(first_item, second_item, label, outCount) {
                if (first_item == null || second_item == null) {
                    return null;
                }
                const power = first_item.power;
                const firstBlock = BLOCK.fromId(first_item.id);
                const maxPower = firstBlock.power;
                if (!power || !maxPower || power >= maxPower) {
                    return null;
                }
                if (label !== false && label !== null) {
                    label = ItemHelpers.validateAndPreprocessLabel(label);
                }
                // find the expected repair ingredients
                const firstBlockName = firstBlock.name;
                let ingredients = REPAIR_BY_NAMES[firstBlockName];
                if (ingredients == null) {
                    if (!REPAIR_SUFFIXES.find(it => firstBlockName.endsWith(it))) {
                        return null;
                    }
                    ingredients = REPAIR_BY_MATERIALS[firstBlock.material?.id];
                    if (ingredients == null) {
                        return null;
                    }
                }
                // check if the expected ingredients match the 2nd slot
                const secondBlockName = BLOCK.fromId(second_item.id).name;
                if (!ingredients.names?.includes(secondBlockName) &&
                    !ingredients.suffixes?.find(it => secondBlockName.endsWith(it))
                ) {
                    return null;
                }
                // do the repair
                const missingPowerPercent = (maxPower - power) / maxPower;
                const maxIngredientsNeeded = Math.ceil(missingPowerPercent / REPAIR_PER_INGREDIENT);
                const usedIngredientsCount = Math.min(second_item.count, maxIngredientsNeeded);
                const powerIncrement = Math.floor(maxPower * REPAIR_PER_INGREDIENT * usedIngredientsCount);
                if (powerIncrement < 1) {
                    return null; // it's possible for very small maxPower and/or REPAIR_PER_INGREDIENT
                }

                outCount[0] = 1;
                outCount[1] = usedIngredientsCount;

                const result = ObjectHelpers.deepClone(first_item);
                result.count = 1;
                result.power = Math.min(maxPower, power + powerIncrement);
                if (label !== false) {
                    ItemHelpers.setLabel(result, label);
                }
                ItemHelpers.incrementExtraDataField(result, 'age', 1);
                return result;
            }
        );

        // combines an item with the same item or a book, merges enchantments
        this.addRecipe('combine',
            function(first_item, second_item, label, outCount) {
                if (first_item == null || second_item == null) {
                    return null;
                }
                // we don't check the 1st item. It considered acceptable if we can repair or enchant it.
                // check the secon item compatibility
                if (second_item.id !== BLOCK.ENCHANTED_BOOK.id && second_item.id !== first_item.id) {
                    return null;
                }
                if (label !== false && label !== null) {
                    label = ItemHelpers.validateAndPreprocessLabel(label);
                }
                const result = ObjectHelpers.deepClone(first_item);
                let changed = false;

                // check if we can repair
                const power = first_item.power;
                const firstBlock = BLOCK.fromId(first_item.id);
                const maxPower = firstBlock.power;
                if (power && maxPower && power < maxPower && second_item.power) {
                    const increment = second_item.power + Math.floor(maxPower * REPAIR_PER_COMBINE_BONUS);
                    result.power = Math.min(maxPower, power + increment);
                    changed = true;
                }

                // check if we can add enchantments
                const first_enchantments = result.extra_data?.enchantments ?? {};
                const second_enchantments = second_item.extra_data?.enchantments;
                if (second_enchantments) {
                    for(const id in second_enchantments) {
                        const enchantment = Enchantments.byId[id];
                        if (!enchantment) {
                            continue; // skip invalid id
                        }
                        const first_level = first_enchantments[id] ?? 0;

                        // if we're adding a new enchantment, check compatibility
                        if (first_level == 0) {
                            if (!Enchantments.isCompatibleType(first_item, enchantment) ||
                                Enchantments.hasIncompatible(first_item, enchantment)
                            ) {
                                continue;
                            }
                        }

                        // calculate the new level
                        const second_level = second_enchantments[id];
                        let new_level = first_level === second_level
                            ? first_level + 1
                            : Math.max(first_level, second_level);
                        // don't allow more than max_level; but don't reduce it if it already exceeds max_level
                        new_level = Math.min(new_level, Math.max(first_level, enchantment.max_level));

                        if (new_level !== first_level) {
                            first_enchantments[id] = new_level;
                            ItemHelpers.setExtraDataField(result, 'enchantments', first_enchantments);
                            changed = true;
                        }
                    }
                }

                // get the result
                if (!changed) {
                    return null;
                }

                outCount[0] = 1;
                outCount[1] = 1;
                
                result.count = 1;
                if (label !== false) {
                    ItemHelpers.setLabel(result, label);
                }
                ItemHelpers.incrementExtraDataField(result, 'age', 1);
                return result;
            }
        );
    }

    addRecipe(id, getResult) {
        this.recipes.set(id, {id, getResult});
    }

    getRecipe(id) {
        if(typeof id !== 'string') {
            throw 'error_invalid_recipe_id';
        }
        return this.recipes.get(id);
    }

    /**
     * @returns { object } {recipe, result} - the recipe that can be applied to the given
     * arguments, and the resulting item. If no recipe is applicable, returns null.
     */
    findRecipeAndResult(first_item, second_item, label, outCount) {
        for(const recipe of this.recipes.values()) {
            try {
                const result = recipe.getResult(first_item, second_item, label, outCount);
                if (result) {
                    return {recipe, result};
                }
            } catch {
                // We expect it throw if it doesn't match. Do nothing.
            }
        }
        return null;
    }

    /**
     * @param { object } used_recipe - see {@link InventoryComparator.checkEqual}, fields:
     *   recipe_id: Int
     *   used_items_keys: Array of String
     *   count: Array of Int
     *   label: (String|false) - if (label === false), it's not being changed
     * @param {Function} recipe
     * @param {Array of Item} used_items
     * @throws if it's imposible
     */
    applyUsedRecipe(used_recipe, recipe, used_items) {
        const outCount = [];
        const result = recipe.getResult(used_items[0], used_items[1], used_recipe.label, outCount);
        if (outCount[0] != used_items[0]?.count || outCount[1] != used_items[1]?.count) {
            throw 'error_recipe_does_not_match_used_items_count';
        }
        return result;
    }

}