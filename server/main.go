package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
)

const PORT = "11435"

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// GET /health
func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]string{"status": "ok", "version": "2.0.0"})
}

// GET /providers
func handleProviders(w http.ResponseWriter, r *http.Request) {
	providers := []map[string]string{
		{"value": "gemini", "label": "Google Gemini"},
		{"value": "openai", "label": "OpenAI"},
		{"value": "groq", "label": "Groq"},
		{"value": "openrouter", "label": "OpenRouter"},
	}
	writeJSON(w, 200, providers)
}

// GET /models?provider=X&apiKey=Y
func handleModels(w http.ResponseWriter, r *http.Request) {
	provider := r.URL.Query().Get("provider")
	apiKey := r.URL.Query().Get("apiKey")

	if provider == "" || apiKey == "" {
		writeError(w, 400, "provider e apiKey são obrigatórios")
		return
	}

	models, err := fetchModels(provider, apiKey)
	if err != nil {
		writeError(w, 502, fmt.Sprintf("Erro ao buscar modelos: %s", err.Error()))
		return
	}

	writeJSON(w, 200, models)
}

// POST /chat
type ChatRequest struct {
	Provider string        `json:"provider"`
	APIKey   string        `json:"apiKey"`
	Model    string        `json:"model"`
	Messages []ChatMessage `json:"messages"`
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func handleChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "método não permitido")
		return
	}

	var req ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "JSON inválido: "+err.Error())
		return
	}

	if req.Provider == "" || req.APIKey == "" || req.Model == "" {
		writeError(w, 400, "provider, apiKey e model são obrigatórios")
		return
	}

	reply, err := callProvider(req.Provider, req.APIKey, req.Model, req.Messages)
	if err != nil {
		writeError(w, 502, err.Error())
		return
	}

	writeJSON(w, 200, map[string]string{"reply": reply})
}

func main() {
	port := PORT
	if p := os.Getenv("PORT"); p != "" {
		port = p
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/providers", handleProviders)
	mux.HandleFunc("/models", handleModels)
	mux.HandleFunc("/chat", handleChat)

	handler := corsMiddleware(mux)

	log.Printf("[PicoClaw Server] Rodando na porta %s", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatalf("Servidor falhou: %v", err)
	}
}
