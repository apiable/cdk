import {Node} from "constructs/lib/construct"

export const fromContextOrDefault = (node: Node, key:string, def: any) => {
    const c =  node.tryGetContext(key)
    if (c && c !== "") {
        return c
    }
    return def
}

export const fromContextOrError = (node: Node, key:string) => {
    const c = fromContextOrDefault(node, key, null)
    if (c){
        return c
    }
    throw new Error(`key=${key} must be set using --context ${key}=value`)
}

export const generateRandomString = (length: number) => {
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
    }
    return result;
}