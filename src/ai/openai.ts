import OpenAI from 'openai'; import { requireEnv } from '../env.js';
let client:OpenAI|undefined; export const getOpenAI=()=>client??=new OpenAI({apiKey:requireEnv('OPENAI_API_KEY')});
export async function structured<T>(args:{model:string;name:string;schema:Record<string,unknown>;input:string;instructions:string;webSearch?:boolean}):Promise<T>{
  const response=await getOpenAI().responses.create({model:args.model,instructions:args.instructions,input:args.input,tools:args.webSearch?[{type:'web_search' as const}]:undefined,tool_choice:args.webSearch?'required':undefined,include:args.webSearch?['web_search_call.action.sources']:undefined,text:{format:{type:'json_schema',name:args.name,strict:true,schema:args.schema}}} as any);
  if(!response.output_text)throw new Error('OpenAI returned no structured output'); return JSON.parse(response.output_text) as T;
}
