# Script para instalar dependencias e iniciar el servidor de Athenea Store
Write-Host "Instalando dependencias de Node.js..." -ForegroundColor Cyan
npm install

Write-Host "Iniciando el servidor local en http://localhost:3000..." -ForegroundColor Green
npm start
