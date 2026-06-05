from typing import Optional
import ollama


class OllamaClient:
    def __init__(self):
        self.model = "gemma4:e2b"
        self.client = ollama.AsyncClient()

    async def generate(self, prompt: str, response_format: Optional[str] = "json"):
        args = {"model": self.model, "prompt": prompt}

        if response_format:
            args["format"] = response_format

        response = await self.client.generate(**args)  # type: ignore
        return response["response"]
