import type { PreparedPost, PublishResult, TokenHealth, ValidationResult } from '../types.js';
import { validatePreparedPost } from '../content/gates.js';
export class PlatformError extends Error { constructor(message:string, readonly status?:number, readonly response?:unknown){super(message);} }
export function classifyError(error: unknown): { retryable:boolean; ambiguous:boolean; message:string } {
  if (error instanceof PlatformError) return { retryable: error.status === 429 || (error.status !== undefined && error.status >= 500), ambiguous: error.status === undefined, message:error.message };
  return {retryable:true,ambiguous:true,message:error instanceof Error?error.message:'Unknown platform error'};
}
export abstract class BasePublisher {
  abstract validateCredentials(): Promise<TokenHealth>; abstract publish(post: PreparedPost): Promise<PublishResult>;
  async validatePost(post:PreparedPost):Promise<ValidationResult>{return validatePreparedPost(post);}
  protected async request(url:string, init:RequestInit={}):Promise<any>{ const response=await fetch(url,init); const text=await response.text(); let body:unknown; try{body=JSON.parse(text);}catch{body={message:text.slice(0,500)}} if(!response.ok) throw new PlatformError(`Platform request failed (${response.status})`,response.status,body); return body; }
}
