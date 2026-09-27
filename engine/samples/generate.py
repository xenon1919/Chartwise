"""Generates the bundled demo datasets (deterministic, seeded).

Run directly to (re)build the CSVs:  python samples/generate.py
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
RNG = np.random.default_rng(42)


def ecommerce(n: int = 6000) -> pd.DataFrame:
    categories = {
        "Electronics": (["Wireless Earbuds", "Smartwatch", "4K Monitor", "Mechanical Keyboard", "USB-C Hub"], (39, 420)),
        "Home & Kitchen": (["Espresso Machine", "Air Fryer", "Chef Knife Set", "Linen Bedding", "Smart Lamp"], (25, 260)),
        "Fashion": (["Denim Jacket", "Running Shoes", "Leather Belt", "Wool Sweater", "Sunglasses"], (19, 180)),
        "Beauty": (["Vitamin C Serum", "Hair Dryer", "Fragrance Set", "Skincare Kit", "Lip Palette"], (12, 140)),
        "Sports": (["Yoga Mat", "Dumbbell Set", "Cycling Helmet", "Trail Backpack", "Fitness Tracker"], (18, 230)),
    }
    cat_weights = np.array([0.30, 0.22, 0.20, 0.13, 0.15])
    regions = {
        "North America": ["United States", "Canada", "Mexico"],
        "Europe": ["United Kingdom", "Germany", "France", "Spain"],
        "Asia Pacific": ["India", "Japan", "Australia", "Singapore"],
        "Latin America": ["Brazil", "Argentina", "Chile"],
    }
    region_weights = np.array([0.40, 0.29, 0.21, 0.10])
    channels = ["Web", "Mobile App", "Marketplace", "Retail Partner"]
    channel_weights = np.array([0.42, 0.33, 0.17, 0.08])

    start = pd.Timestamp("2024-01-01")
    days = (pd.Timestamp("2025-12-31") - start).days + 1
    # Seasonality: growth trend + Nov/Dec holiday peak + summer dip
    day_idx = np.arange(days)
    dates = start + pd.to_timedelta(day_idx, unit="D")
    weight = 1 + day_idx / days * 0.6
    weight *= np.where(dates.month.isin([11, 12]), 1.7, 1.0)
    weight *= np.where(dates.month.isin([7, 8]), 0.85, 1.0)
    weight /= weight.sum()

    rows = []
    order_days = RNG.choice(day_idx, size=n, p=weight)
    for i, d in enumerate(sorted(order_days)):
        cat = RNG.choice(list(categories), p=cat_weights)
        products, (lo, hi) = categories[cat]
        product = products[RNG.integers(len(products))]
        base_price = lo + (hi - lo) * ((sum(map(ord, product)) % 97) / 97)
        unit_price = round(base_price * RNG.uniform(0.92, 1.08), 2)
        region = RNG.choice(list(regions), p=region_weights)
        country = RNG.choice(regions[region])
        units = int(RNG.choice([1, 1, 1, 2, 2, 3, 4]))
        discount = float(RNG.choice([0, 0, 0, 0.05, 0.1, 0.15, 0.2]))
        revenue = round(units * unit_price * (1 - discount), 2)
        rows.append({
            "order_id": 100000 + i,
            "order_date": (start + pd.Timedelta(days=int(d))).strftime("%Y-%m-%d"),
            "region": region,
            "country": country,
            "channel": RNG.choice(channels, p=channel_weights),
            "category": cat,
            "product": product,
            "units": units,
            "unit_price": unit_price,
            "discount": discount,
            "revenue": revenue,
            "customer_rating": int(RNG.choice([3, 4, 4, 5, 5, 5])) if RNG.random() > 0.3 else None,
            "returned": int(RNG.random() < (0.09 if cat == "Fashion" else 0.04)),
        })
    return pd.DataFrame(rows)


def saas(n: int = 1800) -> pd.DataFrame:
    plans = {"Starter": (29, 1, 5), "Growth": (99, 3, 25), "Business": (299, 10, 80), "Enterprise": (1200, 40, 400)}
    plan_weights = np.array([0.45, 0.32, 0.17, 0.06])
    industries = ["Fintech", "Healthcare", "E-commerce", "Education", "Media", "Logistics", "Real Estate"]
    countries = ["United States", "United Kingdom", "Germany", "India", "Canada", "Australia", "France", "Brazil"]
    sources = ["Organic Search", "Paid Ads", "Referral", "Partner", "Outbound Sales"]

    rows = []
    start = pd.Timestamp("2023-01-01")
    for i in range(n):
        plan = RNG.choice(list(plans), p=plan_weights)
        price, seat_lo, seat_hi = plans[plan]
        seats = int(RNG.integers(seat_lo, seat_hi + 1))
        signup = start + pd.Timedelta(days=int(RNG.beta(1.6, 1.0) * 1000))
        churn_p = {"Starter": 0.34, "Growth": 0.2, "Business": 0.11, "Enterprise": 0.05}[plan]
        churned = RNG.random() < churn_p
        churn_date = None
        if churned:
            churn_date = signup + pd.Timedelta(days=int(RNG.integers(35, 540)))
            if churn_date > pd.Timestamp("2025-09-30"):
                churned, churn_date = False, None
        per_seat = price if plan != "Enterprise" else price / 20
        mrr = round(price + max(0, seats - seat_lo) * per_seat * 0.35, 2)
        nps = int(np.clip(RNG.normal(8.4 if not churned else 5.2, 1.6), 0, 10))
        rows.append({
            "customer_id": f"C-{10000 + i}",
            "company": f"{RNG.choice(['Nova', 'Blue', 'Apex', 'Brightly', 'Kite', 'Orbit', 'Summit', 'Pixel', 'Harbor', 'Lumen'])}"
                       f"{RNG.choice(['Labs', 'Works', 'Health', 'Pay', 'Learn', 'Cloud', 'Logistics', 'Studio', 'Systems'])} {i}",
            "signup_date": signup.strftime("%Y-%m-%d"),
            "plan": plan,
            "industry": RNG.choice(industries),
            "country": RNG.choice(countries),
            "acquisition_channel": RNG.choice(sources, p=[0.3, 0.25, 0.2, 0.1, 0.15]),
            "seats": seats,
            "mrr": mrr,
            "nps_score": nps,
            "support_tickets": int(RNG.poisson(3 if not churned else 7)),
            "churned": int(churned),
            "churn_date": churn_date.strftime("%Y-%m-%d") if churn_date is not None else None,
        })
    return pd.DataFrame(rows)


def hr(n: int = 1200) -> pd.DataFrame:
    depts = {
        "Engineering": (["Software Engineer", "Senior Engineer", "Staff Engineer", "Engineering Manager"], 118000),
        "Product": (["Product Manager", "Senior PM", "Product Designer"], 112000),
        "Sales": (["Account Executive", "SDR", "Sales Manager"], 84000),
        "Marketing": (["Marketing Manager", "Content Strategist", "Growth Analyst"], 86000),
        "Customer Success": (["CS Manager", "Support Specialist", "Onboarding Lead"], 68000),
        "Finance": (["Financial Analyst", "Controller", "Accountant"], 92000),
        "People": (["HR Business Partner", "Recruiter", "People Ops"], 76000),
    }
    dept_w = np.array([0.34, 0.1, 0.18, 0.1, 0.14, 0.07, 0.07])
    locations = ["San Francisco", "New York", "London", "Berlin", "Bangalore", "Toronto", "Remote"]
    loc_mult = {"San Francisco": 1.25, "New York": 1.2, "London": 1.05, "Berlin": 0.95, "Bangalore": 0.55, "Toronto": 0.95, "Remote": 1.0}
    rows = []
    for i in range(n):
        dept = RNG.choice(list(depts), p=dept_w)
        roles, base = depts[dept]
        role_i = int(RNG.integers(len(roles)))
        loc = RNG.choice(locations, p=[0.2, 0.15, 0.12, 0.08, 0.15, 0.08, 0.22])
        hire = pd.Timestamp("2016-01-01") + pd.Timedelta(days=int(RNG.beta(2, 1.2) * 3500))
        tenure = (pd.Timestamp("2025-10-01") - hire).days / 365
        level_mult = 1 + role_i * 0.18
        salary = round(base * level_mult * loc_mult[loc] * (1 + tenure * 0.025) * RNG.uniform(0.9, 1.1), -2)
        perf = round(float(np.clip(RNG.normal(3.6, 0.7), 1, 5)), 1)
        rows.append({
            "employee_id": 5000 + i,
            "department": dept,
            "role": roles[role_i],
            "location": loc,
            "gender": RNG.choice(["Female", "Male", "Non-binary"], p=[0.44, 0.53, 0.03]),
            "hire_date": hire.strftime("%Y-%m-%d"),
            "tenure_years": round(tenure, 1),
            "salary": salary,
            "performance_score": perf,
            "engagement_score": int(np.clip(RNG.normal(72 + (perf - 3.6) * 8, 11), 20, 100)),
            "remote": int(loc == "Remote"),
            "left_company": int(RNG.random() < (0.22 if perf < 3 else 0.09)),
        })
    return pd.DataFrame(rows)


SAMPLES = {
    "ecommerce_orders.csv": ecommerce,
    "saas_customers.csv": saas,
    "hr_employees.csv": hr,
}


def ensure_samples() -> None:
    for name, fn in SAMPLES.items():
        path = HERE / name
        if not path.exists():
            fn().to_csv(path, index=False)


if __name__ == "__main__":
    for name, fn in SAMPLES.items():
        df = fn()
        df.to_csv(HERE / name, index=False)
        print(f"{name}: {len(df)} rows")
