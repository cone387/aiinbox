package config

import (
	"fmt"
	"os"

	"github.com/spf13/viper"
)

type Config struct {
	Server    ServerConfig    `mapstructure:"server"`
	Database  DatabaseConfig  `mapstructure:"database"`
	Auth      AuthConfig      `mapstructure:"auth"`
	Search    SearchConfig    `mapstructure:"search"`
	Export    ExportConfig    `mapstructure:"export"`
	RateLimit RateLimitConfig `mapstructure:"rate_limit"`
	CORS      CORSConfig      `mapstructure:"cors"`
	Log       LogConfig       `mapstructure:"log"`
}

type ServerConfig struct {
	Host string `mapstructure:"host"`
	Port int    `mapstructure:"port"`
	Mode string `mapstructure:"mode"`
}

type DatabaseConfig struct {
	Driver       string `mapstructure:"driver"`
	DSN          string `mapstructure:"dsn"`
	MaxOpenConns int    `mapstructure:"max_open_conns"`
	MaxIdleConns int    `mapstructure:"max_idle_conns"`
}

type AuthConfig struct {
	JWTSecret          string `mapstructure:"jwt_secret"`
	JWTExpireMinutes   int    `mapstructure:"jwt_expire_minutes"`
	APITokenExpireDays int    `mapstructure:"api_token_expire_days"`
	BcryptCost         int    `mapstructure:"bcrypt_cost"`
}

type SearchConfig struct {
	MaxResults int `mapstructure:"max_results"`
}

type ExportConfig struct {
	Dir            string `mapstructure:"dir"`
	FileExpireHours int   `mapstructure:"file_expire_hours"`
	MaxConcurrent  int    `mapstructure:"max_concurrent"`
}

type RateLimitConfig struct {
	Enabled          bool `mapstructure:"enabled"`
	AuthMaxAttempts  int  `mapstructure:"auth_max_attempts"`
	AuthBlockMinutes int  `mapstructure:"auth_block_minutes"`
	SearchPerMinute  int  `mapstructure:"search_per_minute"`
	APIPerMinute     int  `mapstructure:"api_per_minute"`
}

type CORSConfig struct {
	AllowedOrigins []string `mapstructure:"allowed_origins"`
	AllowedMethods []string `mapstructure:"allowed_methods"`
}

type LogConfig struct {
	Level    string `mapstructure:"level"`
	Format   string `mapstructure:"format"`
	Output   string `mapstructure:"output"`
	FilePath string `mapstructure:"file_path"`
}

// Load loads configuration from file and environment variables.
// Priority: CLI flag > AIINBOX_CONFIG env > ./config.yaml > ~/.aiinbox/config.yaml
func Load(configPath string) (*Config, error) {
	v := viper.New()
	v.SetConfigType("yaml")

	// Defaults
	v.SetDefault("server.host", "127.0.0.1")
	v.SetDefault("server.port", 9531)
	v.SetDefault("server.mode", "release")
	v.SetDefault("database.driver", "sqlite")
	v.SetDefault("database.dsn", "./data/aiinbox.db")
	v.SetDefault("database.max_open_conns", 10)
	v.SetDefault("database.max_idle_conns", 5)
	v.SetDefault("auth.jwt_secret", "change-me-to-a-secure-secret-at-least-32-chars")
	v.SetDefault("auth.jwt_expire_minutes", 1440)
	v.SetDefault("auth.api_token_expire_days", 30)
	v.SetDefault("auth.bcrypt_cost", 12)
	v.SetDefault("search.max_results", 100)
	v.SetDefault("export.dir", "./data/exports")
	v.SetDefault("export.file_expire_hours", 24)
	v.SetDefault("export.max_concurrent", 3)
	v.SetDefault("rate_limit.enabled", true)
	v.SetDefault("rate_limit.auth_max_attempts", 10)
	v.SetDefault("rate_limit.auth_block_minutes", 15)
	v.SetDefault("rate_limit.search_per_minute", 30)
	v.SetDefault("rate_limit.api_per_minute", 120)
	v.SetDefault("cors.allowed_origins", []string{"http://localhost:9631", "chrome-extension://*"})
	v.SetDefault("cors.allowed_methods", []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"})
	v.SetDefault("log.level", "info")
	v.SetDefault("log.format", "json")
	v.SetDefault("log.output", "stdout")

	// Config file lookup
	if configPath != "" {
		v.SetConfigFile(configPath)
	} else if envPath := os.Getenv("AIINBOX_CONFIG"); envPath != "" {
		v.SetConfigFile(envPath)
	} else {
		v.SetConfigName("config")
		v.AddConfigPath(".")
		v.AddConfigPath("$HOME/.aiinbox")
	}

	// Environment variable override (prefix AIINBOX_)
	v.SetEnvPrefix("AIINBOX")
	v.AutomaticEnv()

	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("failed to read config: %w", err)
		}
		// Config file not found is OK, use defaults
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	return &cfg, nil
}

// Address returns the server listen address.
func (c *Config) Address() string {
	return fmt.Sprintf("%s:%d", c.Server.Host, c.Server.Port)
}
