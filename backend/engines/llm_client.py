from typing import Optional
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline

_llm_pipeline = None


class OllamaClient:
    def __init__(self):
        self.model_name = "Qwen/Qwen2.5-0.5B-Instruct"

    def _get_pipeline(self):
        global _llm_pipeline
        if _llm_pipeline is None:
            tokenizer = AutoTokenizer.from_pretrained(self.model_name)
            model = AutoModelForCausalLM.from_pretrained(
                self.model_name,
                torch_dtype=torch.float32,
                device_map="cpu"
            )
            _llm_pipeline = pipeline(
                "text-generation",
                model=model,
                tokenizer=tokenizer
            )
        return _llm_pipeline

    async def generate(self, prompt: str, response_format: Optional[str] = "json"):
        pipe = self._get_pipeline()
        
        messages = [
            {"role": "system", "content": "You are a helpful evaluation referee. Output raw JSON only, matching the exact format requested."},
            {"role": "user", "content": prompt}
        ]
        
        generation_kwargs = {
            "max_new_tokens": 512,
            "temperature": 0.1,
            "do_sample": False
        }
        
        outputs = pipe(messages, **generation_kwargs)
        result_text = outputs[0]["generated_text"][-1]["content"]
        
        cleaned_text = result_text.strip()
        if cleaned_text.startswith("```"):
            lines = cleaned_text.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned_text = "\n".join(lines).strip()
            
        return cleaned_text


