export interface GenerateImageInput {
  prompt: string;
  negativePrompt: string;
  referenceImageUrls: string[];
  aspectRatio: string;
  peoplePolicy: string;
  model?: string;
}

export interface GenerateImageResult {
  imageBuffer: Buffer;
  provider: string;
  providerJobId: string;
  costUsd: number | null;
  metadata: Record<string, unknown>;
}

export interface ImageProvider {
  generate(input: GenerateImageInput): Promise<GenerateImageResult>;
}
