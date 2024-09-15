import { type Image, createCanvas, loadImage } from "canvas";
import { createHash } from "crypto";
import { type IOption, MaxRectsPacker } from "maxrects-packer";
import { platform } from "os";
import { type SpritesheetData } from "pixi.js";

export const supportedFormats = ["png", "jpeg"] as const;

export interface CompilerOptions {
    /**
    * Format of the output image
    * @default "png"
    */
    outputFormat: typeof supportedFormats[number]

    /**
     * Output directory
     * @default "atlases"
     */
    outDir: string

    name: string

    /**
    * Added pixels between sprites (can prevent pixels leaking to adjacent sprite)
    * @default 1
    */
    margin: number

    /**
     * Remove file extensions from the atlas frames
     * @default true
     */
    removeExtensions: boolean

    /**
    * The Maximum width and height a generated image can be
    * Once a spritesheet exceeds this size a new one will be created
    * @default 4096
    */
    maximumSize: number

    /**
     * maxrects-packer options
     * See https://soimy.github.io/maxrects-packer/
     * Currently does not support `allowRotation` option
     */
    packerOptions: Omit<IOption, "allowRotation">
}

export type AtlasList = Array<{ readonly json: SpritesheetData, readonly image: Buffer }>;

export type MultiResAtlasList = Record<string, {
    readonly low: AtlasList
    readonly high: AtlasList
}>;

/**
 * Pack images spritesheets.
 * @param paths List of paths to the images.
 * @param options Options passed to the packer.
 */
export async function createSpritesheets(
    paths: readonly string[],
    options: CompilerOptions
): Promise<{ readonly low: AtlasList, readonly high: AtlasList }> {
    if (paths.length === 0) throw new Error("No file given.");

    if (!supportedFormats.includes(options.outputFormat)) {
        throw new Error(`outputFormat should only be one of ${JSON.stringify(supportedFormats)}, but "${options.outputFormat}" was given.`);
    }

    interface PackerRectData {
        readonly image: Image
        readonly path: string
    }

    const length = paths.length;
    let resolved = 0;
    let prevLength = 0;
    const max = (a: number, b: number): number => a > b ? a : b;
    const digits = Math.ceil(Math.log10(length));

    const writeFromStart = (str: string): boolean => process.stdout.write(`\r${str}`);

    process.stdout.write(`Loading images: ${"0".padStart(digits, " ")} / ${length}`);
    const results = (await Promise.allSettled(
        paths.map(
            async path => {
                const str = `Loading images: ${(++resolved).toString().padStart(digits, " ")} / ${length} ('${path}')`;
                writeFromStart(str.padEnd(max(str.length, prevLength), " "));
                prevLength = str.length;

                return {
                    image: await loadImage(path),
                    path
                };
            }
        )
    ));
    writeFromStart(`Loaded ${length} images`.padEnd(prevLength, " "));
    console.log();

    const images: readonly PackerRectData[] = results.filter(x => x.status === "fulfilled").map(({ value }) => value);
    const errors = results.filter(x => x.status === "rejected").map(({ reason }) => reason as unknown);
    if (errors.length) {
        throw new AggregateError(errors);
    }

    function createSheet(resolution: number): AtlasList {
        console.log(`Building spritesheet ${options.name} (${resolution}x)`);
        const packer = new MaxRectsPacker(
            options.maximumSize * resolution,
            options.maximumSize * resolution,
            options.margin,
            {
                ...options.packerOptions,
                allowRotation: false // TODO: support rotating frames
            }
        );

        console.log(`Adding ${length} images to packer`);
        for (const image of images) {
            packer.add(
                image.image.width * resolution,
                image.image.height * resolution,
                image
            );
        }

        const atlases: AtlasList = [];

        const binCount = packer.bins.length;
        console.log(`Parsing ${binCount} bins...`);
        let bins = 0;
        for (const bin of packer.bins) {
            const canvas = createCanvas(bin.width, bin.height);

            const ctx = canvas.getContext("2d");

            const json: SpritesheetData = {
                meta: {
                    image: "",
                    scale: resolution,
                    size: {
                        w: bin.width,
                        h: bin.height
                    }
                },
                frames: {}
            };

            const rects = bin.rects.length;
            const digits = Math.ceil(Math.log10(rects));
            let parsed = 0;
            writeFromStart(`Parsing ${rects} rects`);
            for (const rect of bin.rects) {
                const data = rect.data as PackerRectData;

                ctx.drawImage(data.image, rect.x, rect.y, rect.width, rect.height);

                const sourceParts = data.path.split(platform() === "win32" ? "\\" : "/");

                /**
                 * there is _probably_ a file name
                 */
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                let name = sourceParts.at(-1)!;

                if (options.removeExtensions) {
                    name = name.split(".").slice(0, -1).join("");
                }

                json.frames[name] = {
                    frame: {
                        w: rect.width,
                        h: rect.height,
                        x: rect.x,
                        y: rect.y
                    },
                    sourceSize: {
                        w: rect.width,
                        h: rect.height
                    }
                };

                const str = `Parsed ${(++parsed).toString().padStart(digits, " ")} / ${rects} rects`;
                writeFromStart(str.padEnd(max(str.length, prevLength), " "));
                prevLength = str.length;
            }

            writeFromStart("Creating buffer & hash".padEnd(prevLength, " "));
            const buffer = canvas.toBuffer(`image/${options.outputFormat}` as "image/png");

            const hash = createHash("sha1");
            hash.setEncoding("hex");
            hash.write(buffer);
            hash.end();

            json.meta.image = `${options.outDir}/${options.name}-${(hash.read() as string).slice(0, 8)}@${resolution}x.${options.outputFormat}`;

            atlases.push({
                json,
                image: buffer
            });
            writeFromStart(`${++bins} / ${binCount} bins done`.padEnd(prevLength = max(prevLength, 22), " "));
            console.log();
        }

        console.log(`Built spritesheet ${options.name} (${resolution}x)\n`);

        return atlases;
    }

    return {
        low: createSheet(0.5),
        high: createSheet(1)
    };
}
