// Exa API Types
export interface ExaSearchRequest {
  query: string;
  type: string;
  numResults: number;
  contents: {
    text: boolean;
  };
}

export interface ExaSearchResult {
  score: number;
  title: string;
  id: string;
  url: string;
  publishedDate: string;
  author: string;
  text: string;
  image?: string;
  favicon?: string;
}

export interface ExaSearchResponse {
  requestId: string;
  autopromptString: string;
  resolvedSearchType: string;
  results: ExaSearchResult[];
}

// Tool Types
export interface SearchArgs {
  query: string;
  kb?: string;
  numResults?: number;
}

export interface BrianKnowsRequest {
  prompt: string;
  kb?: string;
  address?: string;
  chainId?: string;
  kbId?: string;
}

export interface BrianKnowsResponse {
  result: {
    input: string;
    answer: string;
    context: Array<{
      pageContent: string;
      metadata: {
        description: string;
        language: string;
        source: string;
        title: string;
      }
    }>
  }
}

// Type guard for search arguments
export function isValidSearchArgs(obj: any): obj is SearchArgs {
  return typeof obj === 'object' && 
         obj !== null && 
         typeof obj.query === 'string' &&
         (obj.kb === undefined || typeof obj.kb === 'string') &&
         (obj.numResults === undefined || typeof obj.numResults === 'number');
}

// Recent searches cache type
export interface CachedSearch {
  query: string;
  response: any;
  timestamp: string;
}