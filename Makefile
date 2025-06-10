# Default port for the server
PORT = 8000

.PHONY: serve

# Detect operating system
UNAME := $(shell uname)

# Define the open browser command based on OS
ifeq ($(UNAME), Darwin)
	OPEN_CMD = open
else ifeq ($(UNAME), Linux)
	OPEN_CMD = xdg-open
else
	OPEN_CMD = start
endif

# Serve the project using Python's built-in HTTP server and open browser
serve:
	@echo "Starting server on http://localhost:$(PORT)"
	@(sleep 1 && $(OPEN_CMD) "http://localhost:$(PORT)") &
	@python3 -m http.server $(PORT) 