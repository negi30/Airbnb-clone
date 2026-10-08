"""FastAPI application entrypoint."""
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .routers import bookings, experiences, host, listings, messages, misc
from .seed import init_db
from .services.moderation import ContactInfoProhibited

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Create tables and seed on first boot (free hosting tiers often wipe the disk on redeploy)
    init_db()
    yield


app = FastAPI(title="Airbnb Clone API", version="1.0.0", lifespan=lifespan)

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

app.include_router(listings.router)
app.include_router(bookings.router)
app.include_router(host.router)
app.include_router(experiences.router)
app.include_router(messages.router)
app.include_router(misc.router)


@app.exception_handler(ContactInfoProhibited)
def contact_info_prohibited(_: Request, exc: ContactInfoProhibited):
    # structured so the client can tell a Trust & Safety block from other validation errors;
    # `detail` mirrors `message` for clients that only read FastAPI's usual field
    return JSONResponse(status_code=422, content={"code": exc.code, "message": exc.message, "detail": exc.message})


@app.get("/api/health")
def health():
    return {"status": "ok"}
