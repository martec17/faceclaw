package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// ─────────────────────── FETCH MODELS ────────────────────────

type Model struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

func fetchModels(provider, apiKey string) ([]Model, error) {
	switch provider {
	case "openai":
		return fetchOpenAIModels(apiKey)
	case "groq":
		return fetchGroqModels(apiKey)
	case "openrouter":
		return fetchOpenRouterModels(apiKey)
	case "gemini":
		return fetchGeminiModels(apiKey)
	default:
		return nil, fmt.Errorf("provedor desconhecido: %s", provider)
	}
}

func doGet(url, authHeader string) ([]byte, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	req.Header.Set("User-Agent", "PicoClaw/2.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}
	return body, nil
}

// --- OpenAI: GET /v1/models → filtra gpt-* e o1-*
func fetchOpenAIModels(apiKey string) ([]Model, error) {
	body, err := doGet("https://api.openai.com/v1/models", "Bearer "+apiKey)
	if err != nil {
		return nil, err
	}
	var resp struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}
	var models []Model
	for _, m := range resp.Data {
		if strings.HasPrefix(m.ID, "gpt-") || strings.HasPrefix(m.ID, "o1") || strings.HasPrefix(m.ID, "o3") {
			models = append(models, Model{ID: m.ID, Label: m.ID})
		}
	}
	return models, nil
}

// --- Groq: GET /openai/v1/models → filtra modelos ativos
func fetchGroqModels(apiKey string) ([]Model, error) {
	body, err := doGet("https://api.groq.com/openai/v1/models", "Bearer "+apiKey)
	if err != nil {
		return nil, err
	}
	var resp struct {
		Data []struct {
			ID     string `json:"id"`
			Active bool   `json:"active"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}
	var models []Model
	for _, m := range resp.Data {
		if m.Active {
			models = append(models, Model{ID: m.ID, Label: m.ID})
		}
	}
	return models, nil
}

// --- OpenRouter: GET /api/v1/models → filtra modelos com context_length > 0
func fetchOpenRouterModels(apiKey string) ([]Model, error) {
	body, err := doGet("https://openrouter.ai/api/v1/models", "Bearer "+apiKey)
	if err != nil {
		return nil, err
	}
	var resp struct {
		Data []struct {
			ID            string `json:"id"`
			Name          string `json:"name"`
			ContextLength int    `json:"context_length"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}
	var models []Model
	for _, m := range resp.Data {
		if m.ContextLength > 0 {
			label := m.Name
			if label == "" {
				label = m.ID
			}
			models = append(models, Model{ID: m.ID, Label: label})
		}
	}
	return models, nil
}

// --- Gemini: GET /v1beta/models → filtra que suportam generateContent
func fetchGeminiModels(apiKey string) ([]Model, error) {
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models?key=%s", apiKey)
	body, err := doGet(url, "")
	if err != nil {
		return nil, err
	}
	var resp struct {
		Models []struct {
			Name             string   `json:"name"`
			DisplayName      string   `json:"displayName"`
			SupportedMethods []string `json:"supportedGenerationMethods"`
		} `json:"models"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}
	var models []Model
	for _, m := range resp.Models {
		for _, method := range m.SupportedMethods {
			if method == "generateContent" {
				// name é "models/gemini-2.0-flash", extrai só o ID
				id := strings.TrimPrefix(m.Name, "models/")
				label := m.DisplayName
				if label == "" {
					label = id
				}
				models = append(models, Model{ID: id, Label: label})
				break
			}
		}
	}
	return models, nil
}

// ─────────────────────── CALL PROVIDER (CHAT) ────────────────────────

func callProvider(provider, apiKey, model string, messages []ChatMessage) (string, error) {
	switch provider {
	case "gemini":
		return callGemini(apiKey, model, messages)
	case "openai", "groq", "openrouter":
		return callOpenAICompat(provider, apiKey, model, messages)
	default:
		return "", fmt.Errorf("provedor desconhecido: %s", provider)
	}
}

// --- OpenAI-compatible (openai, groq, openrouter)
func callOpenAICompat(provider, apiKey, model string, messages []ChatMessage) (string, error) {
	baseURLs := map[string]string{
		"openai":     "https://api.openai.com/v1",
		"groq":       "https://api.groq.com/openai/v1",
		"openrouter": "https://openrouter.ai/api/v1",
	}
	base := baseURLs[provider]

	type msg struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	var msgs []msg
	for _, m := range messages {
		msgs = append(msgs, msg{Role: m.Role, Content: m.Content})
	}

	payload := map[string]any{
		"model":    model,
		"messages": msgs,
	}
	b, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", base+"/chat/completions", bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	if provider == "openrouter" {
		req.Header.Set("HTTP-Referer", "https://picoclaw.app")
		req.Header.Set("X-Title", "PicoClaw")
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var data struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return "", fmt.Errorf("resposta inválida: %s", string(body))
	}
	if data.Error != nil {
		return "", fmt.Errorf("%s", data.Error.Message)
	}
	if len(data.Choices) == 0 {
		return "", fmt.Errorf("nenhuma resposta recebida")
	}
	return data.Choices[0].Message.Content, nil
}

// --- Gemini generateContent
func callGemini(apiKey, model string, messages []ChatMessage) (string, error) {
	type part struct {
		Text string `json:"text"`
	}
	type content struct {
		Role  string `json:"role"`
		Parts []part `json:"parts"`
	}

	var contents []content
	for _, m := range messages {
		role := m.Role
		if role == "assistant" {
			role = "model"
		}
		contents = append(contents, content{
			Role:  role,
			Parts: []part{{Text: m.Content}},
		})
	}

	payload := map[string]any{"contents": contents}
	b, _ := json.Marshal(payload)

	url := fmt.Sprintf(
		"https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s",
		model, apiKey,
	)
	req, err := http.NewRequest("POST", url, bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var data struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return "", fmt.Errorf("resposta inválida: %s", string(body))
	}
	if data.Error != nil {
		return "", fmt.Errorf("%s", data.Error.Message)
	}
	if len(data.Candidates) == 0 || len(data.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("nenhuma resposta recebida")
	}
	return data.Candidates[0].Content.Parts[0].Text, nil
}
