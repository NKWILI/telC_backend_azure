export const MODEL_SERVICE_TOKEN = 'MODEL_SERVICE';

export interface ModelService {
  generateTextResponse(prompt: string): Promise<string>;
}
