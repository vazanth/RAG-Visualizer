from collections import defaultdict, deque
from datetime import datetime, timedelta


class RateLimiter:
    def __init__(
        self, requests_per_minute=2, violation_threshold=10, ban_duration_minutes=60
    ):
        self.requests_per_minute = requests_per_minute
        self.violation_threshold = violation_threshold
        self.ban_duration = timedelta(minutes=ban_duration_minutes)

        self.requests = defaultdict(deque)
        self.violations = defaultdict(int)
        self.banned_until = {}

    def allow(self, ip: str) -> bool:
        now = datetime.utcnow()

        # Check ban
        if ip in self.banned_until:
            if now < self.banned_until[ip]:
                return False
            del self.banned_until[ip]

        # Remove requests older than 1 minute
        window = now - timedelta(minutes=1)
        reqs = self.requests[ip]

        while reqs and reqs[0] < window:
            reqs.popleft()

        # Rate limit hit
        if len(reqs) >= self.requests_per_minute:
            self.violations[ip] += 1

            if self.violations[ip] >= self.violation_threshold:
                self.banned_until[ip] = now + self.ban_duration

            return False

        reqs.append(now)
        return True


limiter = RateLimiter(
    requests_per_minute=5, violation_threshold=10, ban_duration_minutes=60
)
