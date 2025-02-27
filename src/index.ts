#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import dotenv from "dotenv";
import {
  BrianKnowsRequest,
  BrianKnowsResponse,
  SearchArgs,
  isValidSearchArgs,
  CachedSearch
} from "./types.js";

dotenv.config();

const API_KEY = process.env.BRIAN_API_KEY;
if (!API_KEY) {
  throw new Error("BRIAN_API_KEY environment variable is required");
}

const API_CONFIG = {
  BASE_URL: 'https://api.brianknows.org',
  ENDPOINTS: {
    PING: '/api/v0/utils/ping',
    AGENT: '/api/v0/agent',
    KNOWLEDGE: '/api/v0/agent/knowledge'
  },
  DEFAULT_KB: 'public-knowledge-box',
  MAX_CACHED_SEARCHES: 5
} as const;

class BrianKnowsServer {
  private server: Server;
  private axiosInstance;
  private recentSearches: CachedSearch[] = [];

  constructor() {
    this.server = new Server({
      name: "brianknows-server",
      version: "0.1.0"
    }, {
      capabilities: {
        resources: {},
        tools: {}
      }
    });

    this.axiosInstance = axios.create({
      baseURL: API_CONFIG.BASE_URL,
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'x-brian-api-key': API_KEY
      }
    });

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      // Convert verbose errors to a single line summary
      const errorMessage = error instanceof Error 
        ? `[MCP Error] ${error.name}: ${error.message}`
        : `[MCP Error] ${String(error)}`;
      
      console.error(errorMessage);
    };

    // Handle JSON parsing errors and other protocol issues
    process.stdin.on('data', (data) => {
      try {
        // Just monitoring the stream, not modifying it
        JSON.parse(data.toString());
      } catch (error) {
        // Silently ignore JSON parse errors from stdin
        // This prevents the verbose stack traces when receiving malformed data
      }
    });

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    this.setupResourceHandlers();
    this.setupToolHandlers();
  }

  private setupResourceHandlers(): void {
    // List available resources (recent searches)
    this.server.setRequestHandler(
      ListResourcesRequestSchema,
      async () => ({
        resources: this.recentSearches.map((search, index) => ({
          uri: `brianknows://searches/${index}`,
          name: `Recent search: ${search.query}`,
          mimeType: "application/json",
          description: `Search results for: ${search.query} (${search.timestamp})`
        }))
      })
    );

    // Read specific resource
    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        const match = request.params.uri.match(/^brianknows:\/\/searches\/(\d+)$/);
        if (!match) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown resource: ${request.params.uri}`
          );
        }

        const index = parseInt(match[1]);
        const search = this.recentSearches[index];

        if (!search) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Search result not found: ${index}`
          );
        }

        return {
          contents: [{
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(search.response, null, 2)
          }]
        };
      }
    );
  }

  private setupToolHandlers(): void {
    // List available tools
    this.server.setRequestHandler(
      ListToolsRequestSchema,
      async () => ({
        tools: [{
          name: "ping",
          description: "Check if the Brian API server is alive",
          inputSchema: {
            type: "object",
            properties: {},
            required: []
          }
        }, {
          name: "search",
          description: "Search using Brian's knowledge engine",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query"
              },
              kb: {
                type: "string",
                description: "Knowledge box to search in (default: public-knowledge-box). Options: circle_kb, lido_kb, Polygon_kb, taiko_kb, near_kb, clave_kb, starknet_kb, consensys_kb"
              }
            },
            required: ["query"]
          }
        }, {
          name: "agent",
          description: "Chat with Brian agent",
          inputSchema: {
            type: "object",
            properties: {
              prompt: {
                type: "string",
                description: "User prompt or question"
              },
              address: {
                type: "string",
                description: "User blockchain address (required for blockchain operations)"
              },
              chainId: {
                type: "string",
                description: "Blockchain chain ID"
              },
              kbId: {
                type: "string",
                description: "Knowledge box ID to use (default: public-knowledge-box)"
              }
            },
            required: ["prompt"]
          }
        }]
      })
    );

    // Handle tool calls
    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        console.log("Request received:", request);
        try {
          if (request.params.name === "ping") {
            return await this.handlePing();
          } else if (request.params.name === "search") {
            if (!isValidSearchArgs(request.params.arguments)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Invalid search arguments"
              );
            }
            return await this.handleSearch(request.params.arguments);
          } else if (request.params.name === "agent") {
            // Validate agent arguments
            if (!request.params.arguments?.prompt) {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Missing required 'prompt' parameter"
              );
            }
            return await this.handleAgent(request.params.arguments);
          } else {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
          }
        } catch (error) {
          if (axios.isAxiosError(error)) {
            return {
              content: [{
                type: "text",
                text: `Brian API error: ${error.response?.data?.error ?? error.message}`
              }],
              isError: true,
            }
          }
          throw error;
        }
      }
    );
  }

  private async handlePing() {
    const response = await this.axiosInstance.get(API_CONFIG.ENDPOINTS.PING);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleSearch(args: SearchArgs) {
    const searchRequest = {
      prompt: args.query,
      kb: args.kb || API_CONFIG.DEFAULT_KB
    };

    const response = await this.axiosInstance.post(
      API_CONFIG.ENDPOINTS.KNOWLEDGE,
      searchRequest
    );

    // Cache the search result
    this.recentSearches.unshift({
      query: searchRequest.prompt,
      response: response.data,
      timestamp: new Date().toISOString()
    });

    // Keep only recent searches
    if (this.recentSearches.length > API_CONFIG.MAX_CACHED_SEARCHES) {
      this.recentSearches.pop();
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleAgent(args: any) {
    const agentRequest = {
      prompt: args.prompt,
      address: args.address || "0x0000000000000000000000000000000000000000", // Default address if not provided
      chainId: args.chainId,
      kbId: args.kbId || API_CONFIG.DEFAULT_KB
    };

    const response = await this.axiosInstance.post(
      API_CONFIG.ENDPOINTS.AGENT,
      agentRequest
    );

    // Cache the agent response
    this.recentSearches.unshift({
      query: agentRequest.prompt,
      response: response.data,
      timestamp: new Date().toISOString()
    });

    // Keep only recent searches
    if (this.recentSearches.length > API_CONFIG.MAX_CACHED_SEARCHES) {
      this.recentSearches.pop();
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("BrianKnows MCP server running on stdio");
  }
}

const server = new BrianKnowsServer();
server.run().catch(console.error);