create table if not exists users (
  id text primary key,
  username text not null unique,
  password_hash text not null,
  display_name text not null,
  role text not null,
  created_at text not null
);

create table if not exists sessions (
  token text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at text not null,
  created_at text not null
);

create table if not exists courses (
  id text primary key,
  title text not null,
  subtitle text not null,
  banner_note text not null,
  created_at text not null
);

create table if not exists lessons (
  id text primary key,
  course_id text not null references courses(id) on delete cascade,
  lesson_no integer not null,
  title text not null,
  date_label text not null,
  summary text not null,
  assignment_title text not null,
  assignment_content text not null,
  assignment_deadline_at text,
  assignment_published_by text,
  assignment_published_at text,
  video_resource_id text,
  handout_resource_id text,
  updated_at text not null
);

create table if not exists resources (
  id text primary key,
  lesson_id text not null references lessons(id) on delete cascade,
  submission_id text,
  kind text not null,
  label text not null,
  original_name text not null,
  mime_type text not null,
  file_path text not null,
  file_size bigint not null,
  uploaded_by text not null,
  created_at text not null
);

create table if not exists submissions (
  id text primary key,
  lesson_id text not null references lessons(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  content text not null,
  attachment_resource_id text references resources(id) on delete set null,
  status text not null,
  created_at text not null,
  updated_at text not null,
  submitted_at text not null
);

create table if not exists access_logs (
  id text primary key,
  user_id text,
  resource_id text not null,
  action text not null,
  detail text,
  created_at text not null
);

create index if not exists idx_lessons_course_no on lessons(course_id, lesson_no);
create index if not exists idx_resources_lesson_kind on resources(lesson_id, kind, created_at desc);
create index if not exists idx_submissions_lesson_time on submissions(lesson_id, submitted_at desc);
create index if not exists idx_submissions_user_time on submissions(user_id, submitted_at desc);
create index if not exists idx_sessions_user on sessions(user_id);
