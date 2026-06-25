# Temporary Hugging Face deployment script
# This script creates a clean commit without the large asset GIFs (which exceed HF's 10MB limit)

Write-Host "1. Creating temporary orphan deployment branch..." -ForegroundColor Blue
git checkout --orphan deploy

Write-Host "2. Resetting staging index to empty..." -ForegroundColor Blue
git reset

Write-Host "3. Staging all files (excluding ignored assets/ and .env)..." -ForegroundColor Blue
git add .

Write-Host "4. Creating clean deployment commit..." -ForegroundColor Blue
git commit -m "Deploy self-contained CPU release"

Write-Host "5. Pushing to Hugging Face main branch..." -ForegroundColor Blue
git push hf deploy:main --force

Write-Host "6. Switching back to local main branch..." -ForegroundColor Blue
git checkout main

Write-Host "7. Cleaning up temporary deployment branch..." -ForegroundColor Blue
git branch -D deploy

Write-Host "Deployment push complete!" -ForegroundColor Green
