import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface OpenAIModelsResponse {
  data: OpenAIModel[];
  object: string;
}

@Injectable({
  providedIn: 'root'
})
export class OpenAiModelService {
  private readonly OPENAI_API_URL = 'https://api.openai.com/v1/models';

  // Fallback models if API fetch fails
  private readonly FALLBACK_MODELS = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-16k'
  ];

  constructor(private http: HttpClient) {}

  /**
   * Fetch available models from OpenAI API
   *
   * @param apiKey OpenAI API key
   * @return Observable of model IDs
   */
  fetchModels(apiKey: string): Observable<string[]> {
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    });

    return this.http.get<OpenAIModelsResponse>(this.OPENAI_API_URL, { headers }).pipe(
      map(response => {
        // Filter for GPT models only
        const gptModels = response.data
          .filter(model => model.id.startsWith('gpt-'))
          .map(model => model.id);

        // Sort models by preference (newer/better models first)
        return this.sortModels(gptModels);
      }),
      catchError(error => {
        console.error('Error fetching OpenAI models:', error);
        // Return fallback models on error
        return of(this.FALLBACK_MODELS);
      })
    );
  }

  /**
   * Get fallback models list
   */
  getFallbackModels(): string[] {
    return [...this.FALLBACK_MODELS];
  }

  /**
   * Sort models by preference (newer/better first)
   */
  private sortModels(models: string[]): string[] {
    const priority = [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-4',
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-16k'
    ];

    return models.sort((a, b) => {
      const aIndex = priority.findIndex(p => a.includes(p));
      const bIndex = priority.findIndex(p => b.includes(p));

      // If both found in priority list, sort by priority
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }

      // If only one found, prioritize it
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;

      // Otherwise, alphabetical
      return a.localeCompare(b);
    });
  }
}
